import { test, expect, ymd, session, makeState, seed, fixRandom, gotoHome, record, skipCoinPopup, addSong } from './helpers.js';

// 記録の短尺動画クリップ（#227）。抽選（recordClipChance）とクリップ選び（pickClip）は単体テスト、再生経路はここ。
//
// 「再生される」ことは Chromium だけで確認する。Playwright の WebKit は H.264 を読み込み切るが playing を
// 出さない（実機の iOS Safari は再生できる）。WebKit では「フォールバックが破綻しない」を @compat で見る。
//
// 「再生されない」ことは、コインのポップアップが出たときに動画が無いことで見る。ポップアップは動画を
// 見終わるまで出ない（#400）ので、固定時間を待たなくても動画を出さないと決まったことが分かる。
test.describe('記録の動画クリップ演出（#227）', () => {
  const clip = (page) => page.locator('#catVideo');
  const playing = (page) => expect(clip(page)).toHaveClass(/cat-video--show/);
  async function expectNoClip(page) {
    await expect(page.locator('#coinPopup')).toHaveClass(/coin-popup--show/);
    await expect(clip(page)).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/cat-clip-playing/);
  }

  // 節目（新しいバッジ・連続の節目）にならない、目標未達の通常の記録になる履歴
  const ordinary = (over = {}) => makeState({
    pet: { xp: 8, coins: 8 },
    streak: { current: 1, best: 1, lastPracticeDate: ymd(1) },
    badges: ['first_practice', 'practice_again'],
    sessions: [session(3, 4), session(1, 4)],
    ...over,
  });

  test('抽選に当たると記録後に動画が出て、タップでスキップできる', async ({ page }) => {
    await seed(page, ordinary());
    await fixRandom(page, 0);
    await gotoHome(page);
    await record(page, 3);
    await playing(page);
    await expect(clip(page).locator('video')).toHaveCount(1);
    await expect(page.locator('body')).toHaveClass(/cat-clip-playing/);

    await clip(page).click();
    await expect(clip(page)).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/cat-clip-playing/);
  });

  test('抽選に外れると動画は出ず、既存のCSS演出にフォールバックする', { tag: '@compat' }, async ({ page }) => {
    await seed(page, ordinary());
    await fixRandom(page, 0.999);
    await gotoHome(page);
    await record(page, 3);
    await expectNoClip(page);
    await expect(page.locator('#catStage .cat')).toBeVisible();
  });

  test('今日の目標に届いた記録は抽選に外れても必ず動画が出て、達成後の追加の記録は抽選に戻る', async ({ page }) => {
    await seed(page, ordinary());
    await fixRandom(page, 0.999);
    await gotoHome(page);
    await record(page, 10);
    await playing(page);
    await clip(page).click();
    await expect(clip(page)).toBeHidden();
    await skipCoinPopup(page);

    await record(page, 1, { song: null });   // 当日ぶんの続き＝11回目
    await expect(page.locator('#coinPopupAmount')).toHaveText('+1');
    await expectNoClip(page);
  });

  test('クリップは2回ループしてから隠れる（#296）', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await fixRandom(page, 0.999);
    await gotoHome(page);
    await record(page, 10);   // 目標達成 → 必ず再生
    await playing(page);
    const video = clip(page).locator('video');
    const durMs = await video.evaluate((v) => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 4) * 1000);

    // 1ループぶんの実時間を過ぎてもまだ再生中（保険タイマーも1ループで切れない）
    await page.waitForTimeout(durMs + 700);
    await playing(page);
    const st = await video.evaluate((v) => ({ ct: v.currentTime, ended: v.ended, paused: v.paused, loop: v.loop }));
    expect(st).toMatchObject({ ended: false, paused: false, loop: false });   // 最終フレームで止まっていない
    expect(st.ct).toBeLessThan(durMs / 1000);                                 // 頭に巻き戻っている

    await expect(clip(page)).toBeHidden({ timeout: durMs + 8000 });
    await expect(page.locator('body')).not.toHaveClass(/cat-clip-playing/);
    expect(errors).toEqual([]);
  });

  test('動画中にもう一度記録すると、前のクリップを畳んで1本だけ張り替える', async ({ page }) => {
    await seed(page, ordinary());
    await fixRandom(page, 0);
    await gotoHome(page);
    await record(page, 1);
    await playing(page);

    await record(page, 1, { song: null });
    await playing(page);
    await expect(clip(page).locator('video')).toHaveCount(1);
    // 前のクリップのタイマー・リスナーが残って手詰まりにならない
    await clip(page).click();
    await expect(clip(page)).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/cat-clip-playing/);
  });

  // えさやりクリップ（#294）は再生と後片付けを共有する。ホームを離れると記録クリップは畳む（#400）
  test('記録クリップの再生中にショップへ移ると畳まれ、えさやりクリップは普通に出る', async ({ page }) => {
    await seed(page, ordinary());
    await fixRandom(page, 0);
    await gotoHome(page);
    await record(page, 1);
    await playing(page);

    await page.click('.nav-btn[data-nav="shop"]');
    await expect(page.locator('body')).not.toHaveClass(/cat-clip-playing/);
    await expect(clip(page)).not.toHaveClass(/cat-video--show/);
    await page.click('.shop-btn[data-action="feed"][data-id="fish"]');
    const popup = page.locator('#feedPopup');
    await expect(popup).toHaveClass(/coin-popup--clip/);
    await popup.click({ position: { x: 10, y: 10 } });
    await expect(popup).toBeHidden();
  });

  test('動画の読み込み中にホームを離れたら、見えないまま再生してポップアップを待たせない（#428）', async ({ page }) => {
    let arrive;
    const late = new Promise((r) => { arrive = r; });
    await page.route('**/video/*_record_*.mp4', async (route) => { await late; await route.continue(); });
    await fixRandom(page, 0.99);   // 目標達成なので必ず動画
    const primed = page.waitForRequest(/_record_.*mp4/);
    await page.goto('/#/record');
    await addSong(page, 'きらきらぼし');
    for (let i = 0; i < 10; i += 1) await page.click('#stampCard');
    await primed;
    await page.evaluate(() => {
      document.getElementById('recordSubmitBtn').click();
      document.querySelector('.nav-btn[data-nav="shop"]').click();
    });
    arrive();
    await expect(page.locator('#coinPopup')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('body')).not.toHaveClass(/cat-clip-playing/);
  });

  // #305: 節目は「その値である間ずっと」でなく「この記録で到達したか」で見る
  test('連続3日の節目に到達した記録は動画を出さず、同じ日の2回目からは出る（#305）', async ({ page }) => {
    await seed(page, ordinary({
      streak: { current: 2, best: 2, lastPracticeDate: ymd(1) },
      badges: ['first_practice', 'practice_again', 'streak_3'],   // バッジ由来の節目と混ざらないように
      sessions: [session(1), session(2)],
    }));
    await fixRandom(page, 0);
    await gotoHome(page);
    await record(page, 3);
    await expectNoClip(page);
    await skipCoinPopup(page);
    await record(page, 3, { song: null });
    await playing(page);
  });

  test('reduced-motion では動画を出さない', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fixRandom(page, 0);
    await gotoHome(page);
    await record(page, 10);   // 抽選にも当たり、目標にも届いている
    await expectNoClip(page);
  });

  test('動画が再生できない環境ではオーバーレイが残らずフォールバックする', { tag: '@compat' }, async ({ page, browserName }) => {
    test.skip(browserName === 'chromium', '再生できる環境では「2回ループしてから隠れる」で見る');
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await fixRandom(page, 0);
    await gotoHome(page);
    await record(page, 10);
    await expect(page.locator('#coinPopup')).toHaveClass(/coin-popup--show/, { timeout: 20000 });
    await expect(clip(page)).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/cat-clip-playing/);
    await expect(page.locator('#catStage .cat')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
