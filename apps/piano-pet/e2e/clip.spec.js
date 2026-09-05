import { test, expect } from '@playwright/test';

// 練習記録の短尺動画クリップ演出（#227）。
// 抽選（recordClipChance）とスタイル選択（pickClip）は単体テスト、再生経路はここで通す。
// 動画は dev サーバ（apps/piano-pet/video/）から実ファイルが配信されるのでモック不要。
//
// 「動画が再生される」系の positive アサーションは Chromium だけで確認する。Playwright の
// WebKit（Windows/Linux ヘッドレス）は H.264 を canPlayType="probably" で読み込み切る（readyState=4）
// が `playing` イベントを発火しない＝実フレーム再生の pipeline が無いため。実 iOS Safari は
// muted インライン H.264 を再生できる。WebKit では代わりに「フォールバックが破綻しない」を @compat で見る。

test.describe('記録の動画クリップ演出（#227）', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    });
  });

  async function addSong(page, name) {
    await page.fill('#newSongInput', name);
    await page.click('#addSongBtn');
  }

  // 初回記録は「はじめての れんしゅう」バッジ、2回目の記録は「また れんしゅうしたね」
  // バッジ（#309）＝どちらも節目になり通常確率の経路に入らない。「目標未達の通常記録」を
  // 検証するテストは、新しいバッジもストリーク節目（3日）も踏まない練習履歴から始める
  // （2日ぶんの履歴を1日空けて置き、streak.current を 1 のまま・uniqueDays を 2 のままにする）。
  async function seedPracticed(page) {
    await page.addInitScript(() => {
      const fmt = (d) => {
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      };
      const today = new Date();
      const dayBefore = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return fmt(d); };
      const older = dayBefore(3); // yesterday と1日空ける＝ストリークは繋がらない
      const yesterday = dayBefore(1);
      localStorage.setItem('piano-pet', JSON.stringify({
        pet: { name: 'きーちゃん', level: 1, xp: 8, coins: 8, equippedItems: [] },
        inventory: [],
        streak: { current: 1, best: 1, lastPracticeDate: yesterday, freezes: 0 },
        badges: ['first_practice', 'practice_again'],
        sessions: [
          { date: older, songs: [{ name: 'きらきらぼし', count: 4 }], totalCount: 4 },
          { date: yesterday, songs: [{ name: 'きらきらぼし', count: 4 }], totalCount: 4 },
        ],
      }));
    });
  }

  test('抽選に当たると記録後に動画が出て、タップでスキップできる', async ({ page }) => {
    await seedPracticed(page);
    await page.addInitScript(() => { Math.random = () => 0; });   // 必ず当たり
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();
    await addSong(page, 'きらきらぼし');
    for (let i = 0; i < 3; i += 1) await page.click('#stampCard');
    await page.click('#recordSubmitBtn');

    await expect(page.locator('#view-home')).toBeVisible();
    const clip = page.locator('#catVideo');
    await expect(clip).toBeVisible();
    await expect(clip).toHaveClass(/cat-video--show/);
    await expect(clip.locator('video')).toHaveCount(1);
    await expect(page.locator('body')).toHaveClass(/cat-clip-playing/);

    // オーバーレイのタップで即スキップ → 隠れる
    await clip.click();
    await expect(clip).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/cat-clip-playing/);
  });

  test('クリップは2回ループしてから隠れる（1ループぶんの時間では消えない）(#296)', async ({ page }) => {
    await page.addInitScript(() => { Math.random = () => 0.99; });   // 確率では外れ → 目標達成で必ず再生
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    await page.click('#goRecordBtn');
    await addSong(page, 'きらきらぼし');
    for (let i = 0; i < 10; i += 1) await page.click('#stampCard');   // 目標達成 → 必ず再生
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();

    const clip = page.locator('#catVideo');
    await expect(clip).toBeVisible();
    await expect(clip).toHaveClass(/cat-video--show/);

    // playing 済みなので duration は確定している（loadedmetadata は過ぎている）
    const durMs = await clip.locator('video')
      .evaluate((v) => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 4) * 1000);

    // 1ループぶん + 余裕を過ぎても、まだ再生中（2ループするので消えない）
    await page.waitForTimeout(durMs + 700);
    await expect(clip).toHaveClass(/cat-video--show/);
    await expect(page.locator('body')).toHaveClass(/cat-clip-playing/);

    // 最終フレームで静止しているのではなく、本当に2周目を再生している（#296 の本質）
    const st = await clip.locator('video')
      .evaluate((v) => ({ ct: v.currentTime, ended: v.ended, paused: v.paused, loop: v.loop }));
    expect(st.ended).toBe(false);
    expect(st.paused).toBe(false);
    expect(st.loop).toBe(false);                    // video.loop ではなく明示的な巻き戻し
    expect(st.ct).toBeLessThan(durMs / 1000);       // 頭に巻き戻っている

    // 2ループ + 保険タイマー（dur*2 + 1s）で最終的には隠れる
    await expect(clip).toBeHidden({ timeout: durMs + 8000 });
    await expect(page.locator('body')).not.toHaveClass(/cat-clip-playing/);
  });

  test('動画中にもう一度記録すると、前のクリップを畳んで1本だけ張り替える', async ({ page }) => {
    await seedPracticed(page);
    await page.addInitScript(() => { Math.random = () => 0; });   // 毎回当たり
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    const clip = page.locator('#catVideo');

    await page.click('#goRecordBtn');
    await addSong(page, 'きらきらぼし');
    await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(clip).toBeVisible();

    // スキップせず、すぐ2本目を記録 → クリップは畳まれて張り替わる
    await page.click('#goRecordBtn');
    await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(clip).toBeVisible();
    await expect(clip).toHaveClass(/cat-video--show/);
    await expect(clip.locator('video')).toHaveCount(1);   // 2本並存しない
    // その後ふつうに終了できる（前のクリップのタイマー/リスナーが残って手詰まりにならない）
    await clip.click();
    await expect(clip).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/cat-clip-playing/);
  });

  test('抽選に外れると動画は出ず、既存のCSS演出にフォールバックする', { tag: '@compat' }, async ({ page }) => {
    await seedPracticed(page);
    await page.addInitScript(() => { Math.random = () => 0.99; });  // 目標未達の通常記録は必ず外れ
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    await page.click('#goRecordBtn');
    await addSong(page, 'ちょうちょ');
    for (let i = 0; i < 3; i += 1) await page.click('#stampCard');
    await page.click('#recordSubmitBtn');

    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#catStage .cat')).toBeVisible();
    // 動画は出ない（フォールバックの happy 演出のみ）
    await expect(page.locator('#catVideo')).toBeHidden();
    await page.waitForTimeout(500);
    await expect(page.locator('#catVideo')).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/cat-clip-playing/);
  });

  // iOS/WebKit: 実フレーム再生ができない環境でも、tryPlay が false を返して既存演出に落ち、
  // オーバーレイが出っぱなしにならない・例外で操作不能にならないこと（受け入れ条件「フォールバック」）。
  test('動画が再生できない環境ではオーバーレイが残らずフォールバックする', { tag: '@compat' }, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { Math.random = () => 0; });   // 抽選は当たり（＝再生を試みる）
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    await page.click('#goRecordBtn');
    await addSong(page, 'きらきらぼし');
    for (let i = 0; i < 10; i += 1) await page.click('#stampCard');   // 目標達成 → 必ず再生を試みる
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();

    // 再生できれば 4s ほどで、できなければ idle(≤2s)+上限(1s)+フェードでフォールバックへ。
    // いずれも最終的に overlay は隠れる（CI の遅さを見込んで余裕をとる）。
    await expect(page.locator('#catVideo')).toBeHidden({ timeout: 15000 });
    await expect(page.locator('body')).not.toHaveClass(/cat-clip-playing/);
    await expect(page.locator('#catStage .cat')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('今日の目標に届いた記録は、抽選に外れても必ず動画が出る（達成後は確率へ戻る）', async ({ page }) => {
    await page.addInitScript(() => { Math.random = () => 0.99; });  // 確率では外れ
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    // 目標（既定10）にちょうど届くまで記録する
    await page.click('#goRecordBtn');
    await addSong(page, 'きらきらぼし');
    for (let i = 0; i < 10; i += 1) await page.click('#stampCard');
    await expect(page.locator('#recordTotal')).toHaveText('10');
    await page.click('#recordSubmitBtn');

    await expect(page.locator('#view-home')).toBeVisible();
    const clip = page.locator('#catVideo');
    await expect(clip).toBeVisible();          // 「必ず」
    await clip.click();
    await expect(clip).toBeHidden();

    // 達成後の追加記録は確率側（外れ）に戻る → 動画は出ない
    await page.click('#goRecordBtn');
    await expect(page.locator('#recordTotal')).toHaveText('10');   // 当日ぶんを引き継ぐ
    await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(clip).toBeHidden();
  });

  test('reduced-motion では動画を出さない', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => { Math.random = () => 0; });   // 抽選は当たりでも
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    await page.click('#goRecordBtn');
    await addSong(page, 'きらきらぼし');
    for (let i = 0; i < 10; i += 1) await page.click('#stampCard');   // 目標達成でも
    await page.click('#recordSubmitBtn');

    await expect(page.locator('#view-home')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.locator('#catVideo')).toBeHidden();
  });
});
