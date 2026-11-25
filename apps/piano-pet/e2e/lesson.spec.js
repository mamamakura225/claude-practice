import { test, expect, ymd, session, makeState, seed, fixRandom, gotoHome, openSettings, closeSettings, record } from './helpers.js';

// レッスン日（#393）。親ゲート内で登録すると練習した日になり、連続+1・コイン10。解除すれば元に戻る。
// 報酬・連続の計算は単体テスト（game.test.js）、ここは app.js がそれを正しい経路で呼ぶことを見る。
test.describe('レッスン日の登録（#393）', () => {
  test.beforeEach(({ page }) => fixRandom(page, 0.999));   // きょうのおまけでコインが揺れないように

  test('今日を登録すると連続1・コイン10・ホーム表示、解除で元に戻る', async ({ page }) => {
    await gotoHome(page);
    await expect(page.locator('#statLessonToday')).toBeHidden();

    await openSettings(page);
    await page.fill('#lessonDateInput', ymd());
    await page.click('#lessonAddBtn');
    await expect(page.locator('#lessonList li')).toHaveCount(1);
    // 枠だけが別スクロールにならず（settings-panel の二重化）、×は押しやすい固定幅で並ぶ
    await expect(page.locator('section.settings-panel')).toHaveCount(0);
    const delBox = await page.locator('#lessonList .lesson-del').boundingBox();
    expect(delBox.width).toBeLessThanOrEqual(60);
    await closeSettings(page);
    await expect(page.locator('#statLessonToday')).toBeVisible();
    await expect(page.locator('#statStreak')).toHaveText('1');
    await expect(page.locator('#statCoins')).toHaveText('10');

    await page.reload();
    await expect(page.locator('#statLessonToday')).toBeVisible();
    await expect(page.locator('#statCoins')).toHaveText('10');

    await openSettings(page);
    await page.click('#lessonList .lesson-del');
    await expect(page.locator('#lessonList li')).toHaveCount(0);
    await closeSettings(page);
    await expect(page.locator('#statLessonToday')).toBeHidden();
    await expect(page.locator('#statStreak')).toHaveText('0');
    await expect(page.locator('#statCoins')).toHaveText('0');
  });

  test('昨日がレッスン日なら起動時に取りこまれ、今日の練習で連続が3日になる', async ({ page }) => {
    await seed(page, makeState({
      pet: { xp: 3, coins: 3, lessonDates: [ymd(1)] },
      streak: { current: 1, best: 1, lastPracticeDate: ymd(2) },
      badges: ['first_practice'],
      sessions: [session(2)],
    }));
    await gotoHome(page);
    // 練習した日として連続に入り、コイン10が加わる（おやすみけんは減らない）
    await expect(page.locator('#statStreak')).toHaveText('2');
    await expect(page.locator('#statCoins')).toHaveText('13');
    await expect(page.locator('#statFreezes')).toHaveText('0');

    await record(page, 3);
    await expect(page.locator('#statStreak')).toHaveText('3');
  });

  test('開いたまま日付をまたいだ記録でも、先に来たレッスン日が連続・コインに入る', async ({ page }) => {
    // 起動時は明日のレッスンが先の予定。時計を翌日へ進めて記録すると、逐次更新ではなく全再計算で
    // 確定してレッスンの分が入る（コイン 3 + 3 + 10）。
    const base = new Date(); base.setHours(12, 0, 0, 0);
    await page.clock.install({ time: base });
    await seed(page, makeState({
      pet: { xp: 3, coins: 3, lessonDates: [ymd(-1)] },
      streak: { current: 1, best: 1, lastPracticeDate: ymd() },
      badges: ['first_practice'],
      sessions: [session(0)],
    }));
    await gotoHome(page);
    await expect(page.locator('#statCoins')).toHaveText('3');

    const next = new Date(base); next.setDate(next.getDate() + 1);
    await page.clock.setSystemTime(next);
    await record(page, 3);
    await expect(page.locator('#statStreak')).toHaveText('2');
    await expect(page.locator('#statCoins')).toHaveText('16');
  });

  test('レッスン当日に練習も記録しても、おやすみけんは二重に付かない', async ({ page }) => {
    await seed(page, makeState({
      pet: { xp: 6, coins: 6, lessonDates: [ymd()] },
      streak: { current: 2, best: 2, lastPracticeDate: ymd(1) },
      badges: ['first_practice', 'practice_again'],
      sessions: [session(1), session(2)],
    }));
    await gotoHome(page);
    // 今日のレッスンが取りこまれ、3日目の節目でお休み券が1枚
    await expect(page.locator('#statStreak')).toHaveText('3');
    await expect(page.locator('#statFreezes')).toHaveText('1');

    await record(page, 3);
    await expect(page.locator('#statStreak')).toHaveText('3');
    await expect(page.locator('#statFreezes')).toHaveText('1');
  });
});
