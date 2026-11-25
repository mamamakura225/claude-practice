import { test, expect } from '@playwright/test';

// 開いたまま日付をまたいだときの、記録の二重計上と表示の更新（#428）。
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const NOON = new Date(); NOON.setHours(12, 0, 0, 0);
const session = (date, count) => ({ date, songs: [{ name: 'きらきらぼし', count }], totalCount: count });

async function boot(page, { sessions, pet = {} }, path = '/') {
  await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
  await page.clock.install({ time: NOON });
  await page.addInitScript((state) => {
    Math.random = () => 0.999;   // おまけ・確率クリップを外す
    localStorage.setItem('piano-pet-onboarded', '1');
    localStorage.setItem('piano-pet', JSON.stringify(state));
  }, {
    pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [], ...pet },
    inventory: [],
    streak: { current: 1, best: 1, lastPracticeDate: sessions[0].date, freezes: 0 },
    badges: ['first_practice', 'practice_again'],
    sessions,
  });
  await page.goto(path);
  await expect(page.locator('.view:not([hidden])')).toBeVisible({ timeout: 10000 });
}

const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')));
const comeBack = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test.describe('日付またぎ（#428）', () => {
  test('記録画面を開いたまま日付をまたいでも、復元した回数を二重に数えない', async ({ page }) => {
    const today = ymd(NOON);
    await boot(page, { sessions: [session(today, 5)] }, '/#/record');
    await expect(page.locator('#recordTotal')).toHaveText('5');
    await page.clock.setSystemTime(new Date(NOON.getTime() + 86400000));
    await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();
    expect((await saved(page)).sessions.map((s) => [s.date, s.totalCount])).toEqual([[today, 6]]);   // 5+6=11 にならない
  });

  test('日付をまたいで戻ると、ホームの きょうの もくひょう と レッスンびが今日のものになる', async ({ page }) => {
    const tomorrow = new Date(NOON.getTime() + 86400000);
    await boot(page, { sessions: [session(ymd(NOON), 10)], pet: { lessonDates: [ymd(tomorrow)] } });
    await expect(page.locator('#statGoalCount')).toHaveText('10');
    await page.clock.setSystemTime(tomorrow);
    await comeBack(page);
    await expect(page.locator('#statGoalCount')).toHaveText('0');
    await expect(page.locator('#statLessonToday')).toBeVisible();
    await expect(page.locator('#statStreak')).toHaveText('2');   // レッスンびが連続に入る
  });

  test('日付をまたいで戻ると、書きかけの無い記録画面は今日になり、書きかけは残る', async ({ page }) => {
    const tomorrow = new Date(NOON.getTime() + 86400000);
    await boot(page, { sessions: [session(ymd(NOON), 5)] }, '/#/record');
    await page.clock.setSystemTime(tomorrow);
    await comeBack(page);
    await expect(page.locator('#recordDate')).toHaveValue(ymd(tomorrow));
    await expect(page.locator('#recordTotal')).toHaveText('0');

    await page.click('.song-chip');
    await page.click('#stampCard');
    await page.clock.setSystemTime(new Date(NOON.getTime() + 2 * 86400000));
    await comeBack(page);
    await expect(page.locator('#recordDate')).toHaveValue(ymd(tomorrow));
    await expect(page.locator('#recordTotal')).toHaveText('1');
  });

  test('保存済みと同じ枚数の書きかけ（過去日・曲の入れ替え）も、日付をまたいで戻っても残る', async ({ page }) => {
    const past = ymd(new Date(NOON.getTime() - 3 * 86400000));
    await boot(page, { sessions: [session(ymd(NOON), 1), session(past, 1)] }, '/#/record');
    await page.fill('#recordDate', past);
    await page.click('#stampCard');
    await page.clock.setSystemTime(new Date(NOON.getTime() + 86400000));
    await comeBack(page);
    await expect(page.locator('#recordDate')).toHaveValue(past);
    await expect(page.locator('#recordTotal')).toHaveText('1');
  });
});
