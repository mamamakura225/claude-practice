import { test, expect, ymd, session, makeState, seed, readLocal, fixRandom, gotoHome, addSong, record, skipCoinPopup } from './helpers.js';

// 記録フォームの日付欄（#273）。当日の記録画面は当日ぶんから復元する（#186）ので、日付だけ過去日へ
// 変えたときに当日ぶんを持ち越すと、過去日の記録として二重に計上される。
test.describe('記録フォームの日付変更', () => {
  test.beforeEach(({ page }) => fixRandom(page, 0.999));

  const total = (page) => page.locator('#recordTotal');
  const open = async (page) => {
    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();
  };
  const boot = async (page) => {   // 今日の記録でバッジが出ない状態から
    await seed(page, makeState({ badges: ['first_practice', 'practice_again'] }));
    await gotoHome(page);
  };

  test('過去日に変えると当日ぶんを持ち越さず、空のままでは記録できない。今日へ戻せば復元される', async ({ page }) => {
    await boot(page);
    await record(page, 5);
    await skipCoinPopup(page);

    await open(page);
    await expect(total(page)).toHaveText('5');   // 当日ぶんの復元
    await page.fill('#recordDate', ymd(2));
    await expect(total(page)).toHaveText('0');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#recordError')).toBeVisible();
    await expect(page.locator('#view-record')).toBeVisible();

    const st = await readLocal(page);
    expect(st.sessions.map((s) => s.totalCount)).toEqual([5]);
    expect(st.pet).toMatchObject({ coins: 5, xp: 5 });

    await page.fill('#recordDate', ymd());
    await expect(total(page)).toHaveText('5');
  });

  test('過去日には過去日ぶんだけが記録される', async ({ page }) => {
    await boot(page);
    await record(page, 5);
    await skipCoinPopup(page);

    await open(page);
    await page.fill('#recordDate', ymd(2));
    await expect(total(page)).toHaveText('0');
    await page.click('.song-chip');            // 復元済みの曲チップから選ぶ
    for (let i = 0; i < 3; i += 1) await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();

    const st = await readLocal(page);
    expect(Object.fromEntries(st.sessions.map((s) => [s.date, s.totalCount]))).toEqual({ [ymd()]: 5, [ymd(2)]: 3 });
    expect(st.pet.coins).toBe(8);   // 5 + 3（どちらも10回未満で達成ボーナスなし）
  });

  test('過去日を触っても当日の下書き（#164）は壊れない', async ({ page }) => {
    await gotoHome(page);
    await open(page);
    await addSong(page, 'ちょうちょう');
    for (let i = 0; i < 3; i += 1) await page.click('#stampCard');

    await page.fill('#recordDate', ymd(3));
    await expect(total(page)).toHaveText('0');
    await page.fill('#recordDate', ymd());
    await expect(total(page)).toHaveText('3');
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet:stamp-draft')));
    expect(draft.stamps).toEqual(['ちょうちょう', 'ちょうちょう', 'ちょうちょう']);
  });

  test('今日の記録を別の日へ動かしたら、今日の記録画面に古い回数が戻らない（#428）', async ({ page }) => {
    await boot(page);
    await record(page, 5);
    await skipCoinPopup(page);
    await open(page);
    await expect(total(page)).toHaveText('5');   // 当日ぶんの復元（#186）
    await page.click('.nav-btn[data-nav="history"]');
    await page.locator('.history-card [data-action="edit-session"]').click();
    await page.fill('#recordDate', ymd(2));
    await page.click('#recordSubmitBtn');
    await expect(page.locator(`.history-card[data-date="${ymd(2)}"]`)).toBeVisible();

    await page.click('.nav-btn[data-nav="home"]');
    await open(page);
    await expect(total(page)).toHaveText('0');
  });

  // 逐次更新（applySession）に過去日を流すと連続が1に巻き戻る。全再計算で確定する
  test('過去日をあとから記録しても、連続日数は巻き戻らない（#260）', async ({ page }) => {
    await seed(page, makeState({
      pet: { xp: 4, coins: 4 },
      streak: { current: 2, best: 2, lastPracticeDate: ymd(1) },
      badges: ['first_practice', 'practice_again'],
      sessions: [session(1, 2), session(2, 2)],
    }));
    await gotoHome(page);
    await expect(page.locator('#statStreak')).toHaveText('2');
    await open(page);
    await page.fill('#recordDate', ymd(7));
    await addSong(page, 'ちょうちょ');
    await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#statStreak')).toHaveText('2');
    expect((await readLocal(page)).sessions.map((s) => s.date).sort()).toEqual([ymd(7), ymd(2), ymd(1)]);
  });

  test('記録済みの過去日を選ぶと、すでにある回数と「たしざん」になることが出る（#398）', async ({ page }) => {
    await seed(page, makeState({ sessions: [session(2, 11)] }));
    await page.goto('/#/record');
    const note = page.locator('#recordDateNote');
    await expect(page.locator('#recordDate')).toBeVisible({ timeout: 10000 });
    await expect(note).toBeHidden();
    await page.fill('#recordDate', ymd(2));
    await expect(note).toContainText('11かい');
    await page.fill('#recordDate', ymd(3));
    await expect(note).toBeHidden();
  });
});
