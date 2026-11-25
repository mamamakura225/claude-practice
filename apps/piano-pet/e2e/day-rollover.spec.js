import { test, expect, ymd, session, makeState, seed, readLocal, fixRandom } from './helpers.js';

// 開いたまま日付をまたいだときの、記録の二重計上と表示の更新（#428）。
const NOON = new Date(); NOON.setHours(12, 0, 0, 0);
const at = (days) => NOON.getTime() + days * 86400000;

async function boot(page, { sessions, pet = {} }, path = '/') {
  await page.clock.install({ time: NOON });
  await fixRandom(page, 0.999);
  await seed(page, makeState({
    pet, sessions,
    streak: { current: 1, best: 1, lastPracticeDate: sessions[0].date },
    badges: ['first_practice', 'practice_again'],
  }));
  await page.goto(path);
  await expect(page.locator('.view:not([hidden])')).toBeVisible({ timeout: 10000 });
}

const comeBack = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test.describe('日付またぎ（#428）', () => {
  test('記録画面を開いたまま日付をまたいでも、復元した回数を二重に数えない', async ({ page }) => {
    await boot(page, { sessions: [session(0, 5)] }, '/#/record');
    await expect(page.locator('#recordTotal')).toHaveText('5');
    await page.clock.setSystemTime(at(1));
    await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();
    expect((await readLocal(page)).sessions.map((s) => [s.date, s.totalCount])).toEqual([[ymd(), 6]]);   // 5+6=11 にならない
  });

  test('日付をまたいで戻ると、ホームの きょうの もくひょう と レッスンびが今日のものになる', async ({ page }) => {
    await boot(page, { sessions: [session(0, 10)], pet: { lessonDates: [ymd(-1)] } });
    await expect(page.locator('#statGoalCount')).toHaveText('10');
    await page.clock.setSystemTime(at(1));
    await comeBack(page);
    await expect(page.locator('#statGoalCount')).toHaveText('0');
    await expect(page.locator('#statLessonToday')).toBeVisible();
    await expect(page.locator('#statStreak')).toHaveText('2');   // レッスンびが連続に入る
  });

  test('日付をまたいで戻ると、書きかけの無い記録画面は今日になり、書きかけは残る', async ({ page }) => {
    await boot(page, { sessions: [session(0, 5)] }, '/#/record');
    await page.clock.setSystemTime(at(1));
    await comeBack(page);
    await expect(page.locator('#recordDate')).toHaveValue(ymd(-1));
    await expect(page.locator('#recordTotal')).toHaveText('0');

    await page.click('.song-chip');
    await page.click('#stampCard');
    await page.clock.setSystemTime(at(2));
    await comeBack(page);
    await expect(page.locator('#recordDate')).toHaveValue(ymd(-1));
    await expect(page.locator('#recordTotal')).toHaveText('1');
  });

  test('保存済みと同じ枚数の書きかけ（過去日・曲の入れ替え）も、日付をまたいで戻っても残る', async ({ page }) => {
    await boot(page, { sessions: [session(0, 1), session(3, 1)] }, '/#/record');
    await page.fill('#recordDate', ymd(3));
    await page.click('#stampCard');
    await page.clock.setSystemTime(at(1));
    await comeBack(page);
    await expect(page.locator('#recordDate')).toHaveValue(ymd(3));
    await expect(page.locator('#recordTotal')).toHaveText('1');
  });
});
