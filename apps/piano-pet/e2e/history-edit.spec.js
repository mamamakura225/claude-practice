import { test, expect } from '@playwright/test';

// きろく一覧からの編集・削除・スタンプ付与（#145 はなまる / #239 練習の質メモ）。
//
// 一覧は日付降順に並べ替えつつ data-index には**元配列のインデックス**を載せている
// （app.js の renderHistory）。この二重管理を壊すと「別の記録を消す・別の記録にスタンプが付く」
// という気づきにくい退行になるため、並び順とインデックスがズレていないことをここで固定する。
test.describe('きろくの編集・削除・スタンプ', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
      // 元配列は「日付昇順」で入れる＝表示（降順）とインデックス順が逆になる配置。
      // ここが取り違えの起きやすい形なので、あえてこの並びで検証する。
      const s = {
        version: 2,
        pet: {
          name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [], placedItems: [],
          itemLayout: {}, affinity: 0, foodSpent: 0, dailyGoal: 10, catStyle: 'tora',
          childName: '', childAvatar: 'chick',
        },
        inventory: [],
        streak: { current: 0, best: 0, lastPracticeDate: null, freezes: 0 },
        // 3日連続なので checkBadges 済みの状態＝実アプリが保存する形で置く
        badges: ['first_practice', 'streak_3'],
        sessions: [
          { date: '2026-01-01', totalCount: 2, songs: [{ name: 'ふるいきょく', count: 2 }] },
          { date: '2026-01-02', totalCount: 3, songs: [{ name: 'まんなか', count: 3 }] },
          { date: '2026-01-03', totalCount: 4, songs: [{ name: 'あたらしいきょく', count: 4 }] },
        ],
        settings: { soundOn: true },
      };
      try { localStorage.setItem('piano-pet', JSON.stringify(s)); } catch { /* 無視 */ }
    });
  });

  const readLocal = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')));

  async function openHistory(page) {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await page.click('.nav-btn[data-nav="history"]');
    await expect(page.locator('#view-history')).toBeVisible();
    await expect(page.locator('#historyList .history-card')).toHaveCount(3);
  }

  test('一覧は新しい順に並ぶ', async ({ page }) => {
    await openHistory(page);
    await expect(page.locator('#historyList .history-card__day')).toHaveText([
      '1月3日（土）', '1月2日（金）', '1月1日（木）',
    ]);
  });

  test('先頭（最新）を消すとその日だけが消える', async ({ page }) => {
    await openHistory(page);
    page.once('dialog', (d) => d.accept());
    await page.locator('#historyList .history-card').first().locator('[data-action="delete-session"]').click();

    await expect(page.locator('#historyList .history-card')).toHaveCount(2);
    const st = await readLocal(page);
    expect(st.sessions.map((s) => s.date)).toEqual(['2026-01-01', '2026-01-02']);
    expect(st.pet.coins).toBe(5);   // 2 + 3（4かいぶんが消えて再計算される）
  });

  test('最後（最古）を消すとその日だけが消える', async ({ page }) => {
    await openHistory(page);
    page.once('dialog', (d) => d.accept());
    await page.locator('#historyList .history-card').last().locator('[data-action="delete-session"]').click();

    const st = await readLocal(page);
    expect(st.sessions.map((s) => s.date)).toEqual(['2026-01-02', '2026-01-03']);
    expect(st.pet.coins).toBe(7);   // 3 + 4
  });

  test('削除の確認をキャンセルすると何も消えない', async ({ page }) => {
    await openHistory(page);
    page.once('dialog', (d) => d.dismiss());
    await page.locator('#historyList .history-card').first().locator('[data-action="delete-session"]').click();

    await expect(page.locator('#historyList .history-card')).toHaveCount(3);
    expect((await readLocal(page)).sessions).toHaveLength(3);
  });

  test('編集すると対象の記録だけが更新され、コインが再計算される', async ({ page }) => {
    await openHistory(page);
    // 表示の真ん中＝2026-01-02（元配列では index 1）
    await page.locator('#historyList .history-card').nth(1).locator('[data-action="edit-session"]').click();
    await expect(page.locator('#view-record')).toBeVisible();
    await expect(page.locator('#recordDate')).toHaveValue('2026-01-02');
    await expect(page.locator('#recordTotal')).toHaveText('3');

    await page.click('#stampCard');           // 3 → 4 かい
    await expect(page.locator('#recordTotal')).toHaveText('4');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-history')).toBeVisible();

    const st = await readLocal(page);
    const byDate = Object.fromEntries(st.sessions.map((s) => [s.date, s.totalCount]));
    expect(byDate).toEqual({ '2026-01-01': 2, '2026-01-02': 4, '2026-01-03': 4 });
    // 2+4+4=10 に、3日連続到達のマイルストーン +10（calcRewards）が乗る
    expect(st.pet.coins).toBe(20);
  });

  test('はなまる（#145）と ようす（#239）は押した記録にだけ付き、再タップで外れる', async ({ page }) => {
    await openHistory(page);
    const middle = page.locator('#historyList .history-card').nth(1);   // 2026-01-02

    await middle.locator('.praise-stamp').first().click();              // 💮 はなまる
    await expect(middle.locator('.praise-stamp').first()).toHaveAttribute('aria-pressed', 'true');
    await middle.locator('.tempo-stamp').last().click();                // 🚀 はやく
    await expect(middle.locator('.tempo-stamp').last()).toHaveAttribute('aria-pressed', 'true');

    let st = await readLocal(page);
    expect(st.sessions.find((s) => s.date === '2026-01-02').praise).toBe('hanamaru');
    expect(st.sessions.find((s) => s.date === '2026-01-02').tempo).toBe('fast');
    // 他の記録には付いていない（インデックス取り違えの検知）
    expect(st.sessions.find((s) => s.date === '2026-01-03').praise ?? null).toBeNull();
    expect(st.sessions.find((s) => s.date === '2026-01-01').praise ?? null).toBeNull();

    await middle.locator('.praise-stamp').first().click();              // 再タップで解除
    await expect(middle.locator('.praise-stamp').first()).toHaveAttribute('aria-pressed', 'false');
    st = await readLocal(page);
    expect(st.sessions.find((s) => s.date === '2026-01-02').praise).toBeNull();
    expect(st.sessions.find((s) => s.date === '2026-01-02').tempo).toBe('fast');   // ようすは残る

    // 画面を離れて戻っても保持される（renderHistory が state から描き直す）。
    // ここで reload しないのは、seed 用の addInitScript がリロードでも再実行されて
    // localStorage を初期状態へ巻き戻してしまうため（永続化そのものは上の localStorage 検査で担保）。
    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#view-home')).toBeVisible();
    await page.click('.nav-btn[data-nav="history"]');
    await expect(page.locator('#historyList .history-card').nth(1).locator('.tempo-stamp').last())
      .toHaveAttribute('aria-pressed', 'true');
  });

  test('編集・削除で失った資格のバッジは剥がれる', async ({ page }) => {
    await openHistory(page);
    // 3日ぶんあるので first_practice は取得済み
    await page.click('.nav-btn[data-nav="badges"]');
    await expect(page.locator('#badgeGrid .badge-card').first()).not.toHaveClass(/badge-card--locked/);

    // 全部消すと剥がれる
    await page.click('.nav-btn[data-nav="history"]');
    for (let i = 0; i < 3; i += 1) {
      page.once('dialog', (d) => d.accept());
      await page.locator('#historyList .history-card').first().locator('[data-action="delete-session"]').click();
      await expect(page.locator('#historyList .history-card')).toHaveCount(2 - i);
    }
    await page.click('.nav-btn[data-nav="badges"]');
    await expect(page.locator('#badgeGrid .badge-card').first()).toHaveClass(/badge-card--locked/);
    await expect(page.locator('#badgesCount')).toHaveText('0 / 24 こ ゲット！');
  });
});
