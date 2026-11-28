import { test, expect, ymd, session, makeState, seed, fixRandom, gotoHome, record } from './helpers.js';

// 記録後のごほうびのポップアップ：出る内容・順番・後始末（#323・#400）。
// 「出た」は --show クラスで、「消えた」は toBeHidden() で見る。toBeVisible() は opacity を見ないので、
// --show が付かず演出が一切見えない退行でも通ってしまう。
const SHOWN = /coin-popup--show/;
const coin = (page) => page.locator('#coinPopup');
const badge = (page) => page.locator('#badgePopup');
const badgeName = (page) => page.locator('#badgePopupName');

test.describe('ごほうびのポップアップ', () => {
  test('お休み券で連続を守った記録は、コイン→お休み券→バッジ2枚の順に1つずつ出る', async ({ page }) => {
    // 1日抜けているのを券1枚で救済。バッジは2つ同時に成立する（1つ目で連鎖が切れる退行を見る）。
    // 「はじめて」は起動時に付くので、この記録で取れるのは 2にち目 と 5曲目
    await seed(page, makeState({
      streak: { current: 1, best: 1, lastPracticeDate: ymd(2), freezes: 1 },
      sessions: [{ ...session(2), songs: ['あ', 'い', 'う', 'え'].map((name) => ({ name, count: 1 })), totalCount: 4 }],
    }));
    await fixRandom(page, 0.999);
    await gotoHome(page);
    await expect(page.locator('#statFreezes')).toHaveText('1');
    await record(page, 3);

    const freeze = page.locator('#freezePopup');
    await expect(coin(page)).toHaveClass(SHOWN);
    await expect(coin(page)).toBeHidden();
    await expect(page.locator('#statFreezes')).toHaveText('0');
    await expect(freeze).toHaveClass(SHOWN);
    expect(await badge(page).evaluate((el) => el.classList.contains('coin-popup--show')),
      'お休み券の表示中はまだバッジを出さない').toBe(false);
    await expect(freeze).toBeHidden();

    await expect(badge(page)).toHaveClass(SHOWN);
    await expect(badgeName(page)).toHaveText('また れんしゅうしたね');
    // 2枚目は消えたあとも残る文字で見る（遅い環境で表示の瞬間を取りこぼさない）
    await expect(badgeName(page)).toHaveText('いろいろな きょく', { timeout: 15000 });
  });

  test('きょうのおまけが当たると+3コインのポップアップが出る', async ({ page }) => {
    await fixRandom(page, 0);
    await gotoHome(page);
    await record(page, 3);
    await expect(page.locator('#bonusPopup')).toHaveClass(SHOWN);
    await expect(page.locator('#statCoins')).toHaveText('6');   // 3かい + おまけ3（文言は HTML の初期値と同じなので残高で裏を取る）
  });

  test('レベルが上がる記録では、コインのポップアップにレベルアップが出る', async ({ page }) => {
    await seed(page, makeState({ pet: { xp: 16 }, badges: ['first_practice'] }));
    await fixRandom(page, 0.999);
    await gotoHome(page);
    await record(page, 5);   // xp 16+5=21 → レベル2（20）
    await expect(coin(page)).toHaveClass(SHOWN);
    await expect(page.locator('#coinPopupLevelUp')).toHaveText('レベル 2 に アップ！🎉');
  });

  test('バッジが3つ以上取れたら、2つ目以降は1枚にまとめて出す（#400）', async ({ page }) => {
    // 初回に同じ曲を20回＝はじめて・同じ曲10回・1日20回の3つが一度に取れる
    await fixRandom(page, 0.999);
    await gotoHome(page);
    await record(page, 20);
    const gained = await page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')).badges.length);
    expect(gained, 'この記録で一度に3つ以上取れる前提').toBeGreaterThanOrEqual(3);
    await expect(badgeName(page)).toContainText('・', { timeout: 20000 });
    expect((await badgeName(page).textContent()).split('・')).toHaveLength(gained - 1);
    await expect(badge(page)).toBeHidden({ timeout: 5000 });   // まとめた後は続かない
  });

  test('続けて獲得したバッジは、前のものを置き換えず順に出る（#428）', async ({ page }) => {
    await gotoHome(page);
    await badgeName(page).evaluate((el) => {
      window.__names = [];
      new MutationObserver(() => window.__names.push([el.textContent, performance.now()])).observe(el, { childList: true });
    });
    // 画面の操作では2回の獲得を同じ2秒に重ねられないので、アプリと同じモジュールを直接2回呼ぶ
    await page.evaluate(async () => {
      const { showBadgePopup } = await import('/js/popups.js');
      showBadgePopup([{ icon: '1', name: 'ひとつめ' }]);
      showBadgePopup([{ icon: '2', name: 'ふたつめ' }]);
    });
    await expect(badgeName(page)).toHaveText('ふたつめ', { timeout: 6000 });
    const names = await page.evaluate(() => window.__names);
    expect(names.map(([n]) => n)).toEqual(['ひとつめ', 'ふたつめ']);
    expect(names[1][1] - names[0][1]).toBeGreaterThan(2000);   // 1枚目も読める長さで出ている
  });

  test('条件を満たしているバッジは、起動した時点で一覧に付いている', async ({ page }) => {
    // 足したばかりのバッジ（記録10日）を、バッジ未取得のまま持っている端末
    await seed(page, makeState({ sessions: Array.from({ length: 10 }, (_, i) => session(i + 2, 1)) }));
    await gotoHome(page);
    await page.click('.nav-btn[data-nav="badges"]');
    const card = page.locator('#badgeGrid .badge-card').filter({ hasText: 'きろく 10にち' });
    await expect(card).not.toHaveClass(/badge-card--locked/);
    await expect(badge(page)).toBeHidden();   // 起動時は告知しない
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')).badges)).toContain('days_10');
  });

  test('ポップアップはタップで次へ送れる（#400）', async ({ page }) => {
    await fixRandom(page, 0.999);
    await gotoHome(page);
    await record(page, 3);
    await expect(coin(page)).toHaveClass(SHOWN);
    await coin(page).click();
    await expect(coin(page)).toBeHidden({ timeout: 1000 });
  });

  test('同じ内容で記録し直しても「+0 コイン ゲット！」と祝わない（#396）', async ({ page }) => {
    await seed(page, makeState({ badges: ['first_practice'], sessions: [session(0)] }));
    await fixRandom(page, 0.999);
    await gotoHome(page);
    await record(page, 0, { song: null });   // 当日ぶんで復元された内容のまま送信
    await expect(coin(page)).toHaveClass(SHOWN);
    await expect(page.locator('#coinPopupLabel')).toHaveText('きろくを なおしたよ');
    await expect(page.locator('#coinPopupAmount')).toBeHidden();
  });
});

test.describe('動画とポップアップの順番（#400）', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', '動画の再生は Chromium のみで確認する（clip.spec.js）');
  // 節目にならない通常の記録・抽選は必ず当たり
  test.beforeEach(async ({ page }) => {
    await seed(page, makeState({
      pet: { xp: 8, coins: 8 },
      streak: { current: 1, best: 1, lastPracticeDate: ymd(1) },
      badges: ['first_practice', 'practice_again'],
      sessions: [session(3, 4), session(1, 4)],
    }));
    await fixRandom(page, 0);
    await gotoHome(page);
  });

  test('動画のあいだはコインのポップアップを出さず、スキップすると出る', async ({ page }) => {
    await record(page, 3);
    await expect(page.locator('#catVideo')).toHaveClass(/cat-video--show/);
    await page.waitForTimeout(500);   // 「出ない」ことの証拠時間
    await expect(coin(page)).toBeHidden();
    await page.locator('#catVideo').click();
    await expect(coin(page)).toHaveClass(SHOWN);
  });

  test('動画中に記録画面へ移っても、前の記録のコインのポップアップは失われない', async ({ page }) => {
    await coin(page).evaluate((el) => {   // 出た瞬間を取りこぼさないようページ内で数える
      window.__coinShown = 0;
      new MutationObserver(() => { if (el.classList.contains('coin-popup--show')) window.__coinShown += 1; })
        .observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    await record(page, 3);
    await expect(page.locator('#catVideo')).toHaveClass(/cat-video--show/);
    await page.click('#goRecordBtn');
    await expect.poll(() => page.evaluate(() => window.__coinShown), { timeout: 8000 }).toBeGreaterThanOrEqual(1);
  });
});

// test.use({ reducedMotion }) は効かないので emulateMedia で指定する
test.describe('prefers-reduced-motion', () => {
  test.beforeEach(({ page }) => page.emulateMedia({ reducedMotion: 'reduce' }));

  // transition:none では transitionend が来ない。保険タイマーが無いと hidden へ戻らず、バッジの連鎖も止まる
  test('バッジ2枚が順に出て、最後はすべて隠れる', async ({ page }) => {
    await seed(page, makeState({ sessions: [session(5)] }));
    await fixRandom(page, 0.999);
    await gotoHome(page);
    await record(page, 3);
    await expect(coin(page)).toHaveClass(SHOWN);
    await expect(coin(page)).toBeHidden({ timeout: 5000 });
    await expect(badgeName(page)).toHaveText('また れんしゅうしたね', { timeout: 15000 });
    await expect(badge(page)).toBeHidden();
  });

  test('ハンコに短い手応え（色の変化）が、いま押したマスにだけ残る', async ({ page }) => {
    await seed(page, makeState({ sessions: [session(5)] }));
    await page.goto('/#/record');
    await expect(page.locator('#stampCard')).toBeVisible({ timeout: 10000 });
    await page.click('#stampCard');
    await page.click('#stampCard');
    const anims = await page.locator('.stamp-cell.is-filled').evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
    expect(anims).toEqual(['none', 'stamp-fade']);   // 全マスだと押すたびにカード全体が点滅する
  });
});
