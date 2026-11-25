import { test, expect, ymd, session, makeState, seed, gotoHome, openSettings, closeSettings } from './helpers.js';

// きろく画面と設定画面の整理（#401）・練習カレンダー（#236）。
async function boot(page, { sessions = [], pet = {} } = {}) {
  await page.setViewportSize({ width: 375, height: 667 });
  await seed(page, makeState({ pet, sessions }));
}

const bg = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe('きろく画面の整理（#401）', () => {
  test('カレンダー: 前の月・次の月へ移れ、目標は保存値で判定し、練習しなかった日・先の日も見分けられる', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-06-15T12:00:00'));   // 月の端だと過去・先の日が無い
    await boot(page, { pet: { dailyGoal: 5 }, sessions: [session('2026-06-15', 5), session('2026-06-13', 1)] });
    await page.goto('/#/history');
    const title = page.locator('#calTitle');
    await expect(title).toHaveText('2026年6月', { timeout: 10000 });
    const today = page.locator('#calGrid .cal-cell--today');
    const cell = (date) => page.locator(`#calGrid .cal-cell[data-date="${date}"]`);
    await expect(today).toHaveAttribute('data-level', '3');   // 目標5を5回で達成（既定の10なら 2）
    await expect(cell('2026-06-13')).toHaveAttribute('data-level', '1');
    const none = page.locator('#calGrid .cal-cell[data-level="0"]:not(.cal-cell--future):not(.cal-cell--pad)').first();
    expect(await bg(none)).not.toBe(await bg(cell('2026-06-13')));
    expect(await bg(none)).toBe('rgb(255, 255, 255)');   // 白抜き
    const future = page.locator('#calGrid .cal-cell--future').first();
    expect(await future.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');   // 先の日も日付が読める

    await page.click('#calPrevBtn');
    await expect(title).toHaveText('2026年5月');
    await page.click('#calNextBtn');
    await page.click('#calNextBtn');
    await expect(title).toHaveText('2026年7月');
  });

  test('カレンダーの日を押すと、一覧の表示件数の外でもその日の記録へ移る', async ({ page }) => {
    const sessions = Array.from({ length: 30 }, (_, i) => session(i + 1));
    await boot(page, { sessions });
    await page.goto('/#/history');
    await expect(page.locator('#calPrevBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#historyList .history-card')).toHaveCount(14);
    const target = ymd(28);   // 一覧の直近14件より古い日
    if (!(await page.locator(`#calGrid .cal-cell[data-date="${target}"]`).count())) await page.click('#calPrevBtn');
    await page.click(`#calGrid .cal-cell[data-date="${target}"]`);
    const card = page.locator(`#historyList .history-card[data-date="${target}"]`);
    await expect(card).toBeVisible();
    await expect(card).toBeInViewport();
    // 「なおす」へフォーカス（先頭のスタンプだと Enter で印が付く）
    expect(await page.evaluate(() => document.activeElement?.dataset.action)).toBe('edit-session');
  });

  test('「なおす」→「もどる」は きろく の元の位置へ戻り、編集中のナビは きろく', async ({ page }) => {
    const sessions = Array.from({ length: 10 }, (_, i) => session(i + 1));
    await boot(page, { sessions });
    await page.goto('/#/history');
    const edit = page.locator('[data-action="edit-session"]').nth(6);
    await expect(edit).toBeAttached({ timeout: 10000 });
    await edit.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => window.scrollY);
    expect(y).toBeGreaterThan(0);
    await edit.click();
    await expect(page.locator('#view-record')).toBeVisible();
    await expect(page.locator('.nav-btn[data-nav="history"]')).toHaveClass(/active/);
    await expect(page.locator('.nav-btn[data-nav="home"]')).not.toHaveClass(/active/);
    await expect(page.locator('.nav-btn[data-nav="history"]')).toHaveAttribute('aria-current', 'page');
    await page.click('#recordBackBtn');
    await expect(page.locator('#view-history')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);

    // 保存でも同じ位置へ戻る
    await edit.click();
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-history')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);

    // そのあと通常の記録画面を開くと、ナビは ホーム に戻っている
    await page.click('.nav-btn[data-nav="home"]');
    await page.click('#goRecordBtn');
    await expect(page.locator('.nav-btn[data-nav="home"]')).toHaveClass(/active/);
    await expect(page.locator('.nav-btn[data-nav="history"]')).not.toHaveClass(/active/);
  });

  test('日付を変えて保存すると、直した記録へ移る', async ({ page }) => {
    const sessions = Array.from({ length: 20 }, (_, i) => session(i + 1));
    await boot(page, { sessions });
    await page.goto('/#/history');
    await page.locator('[data-action="edit-session"]').nth(2).click();
    await expect(page.locator('#view-record')).toBeVisible();
    await page.fill('#recordDate', ymd(40));   // 表示範囲（直近14件）の外へ
    await page.locator('#recordDate').dispatchEvent('change');
    await page.click('#recordSubmitBtn');
    await expect(page.locator(`#historyList .history-card[data-date="${ymd(40)}"]`)).toBeInViewport();
  });

  test('曲別コレクションは上位5曲で、「もっと みる」で全曲', async ({ page }) => {
    const sessions = ['あ', 'い', 'う', 'え', 'お', 'か', 'き'].map((n, i) => session(i + 1, 10 - i, n));
    await boot(page, { sessions });
    await page.goto('/#/history');
    const items = page.locator('.song-collection__item');
    await expect(items).toHaveCount(5, { timeout: 10000 });
    await expect(items.first()).toContainText('あ');
    await page.click('[data-action="more-songs"]');
    await expect(items).toHaveCount(7);
    await expect(page.locator('[data-action="more-songs"]')).toHaveCount(0);
    // ナビから入り直すと畳む
    await page.click('.nav-btn[data-nav="home"]');
    await page.click('.nav-btn[data-nav="history"]');
    await expect(items).toHaveCount(5);
  });

  test('記録カードのスタンプ2段に見出しがあり、記録画面の単位は「かい」・もどるはホームへ', async ({ page }) => {
    await boot(page, { sessions: [session(1)] });
    await page.goto('/#/history');
    await expect(page.locator('.praise-row .mark-label')).toHaveText('はなまる', { timeout: 10000 });
    await expect(page.locator('.tempo-row .mark-label')).toHaveText('ようす');
    await page.goto('/#/record');
    await expect(page.locator('.stamp-progress')).toContainText('かい / もくひょう');
    await expect(page.locator('.stamp-progress')).not.toContainText('こ');
    await page.click('#recordBackBtn');   // 「なおす」から来ていなければホームへ
    await expect(page.locator('#view-home')).toBeVisible();
  });
});

test.describe('設定画面の整理（#401）', () => {
  test('レッスン日の一覧は過去3件＋先の予定ぜんぶ。「もっと みる」や、古い日を足したときは広げる', async ({ page }) => {
    const lessonDates = [ymd(12), ymd(10), ymd(8), ymd(6), ymd(4), ymd(-5)];
    await boot(page, { pet: { lessonDates } });
    await gotoHome(page);
    await openSettings(page);
    const rows = page.locator('#lessonList .lesson-del');
    await expect(rows).toHaveCount(4);   // 予定1＋過去3
    await page.click('#lessonList .lesson-more');
    await expect(rows).toHaveCount(6);
    await expect(page.locator('#lessonList .lesson-more')).toHaveCount(0);

    // 畳んだ範囲より古い日を入れ忘れで足すと、広げて見せる
    await closeSettings(page);
    await openSettings(page);
    await expect(rows).toHaveCount(4);
    await page.fill('#lessonDateInput', ymd(20));
    await page.click('#lessonAddBtn');
    await expect(page.locator(`#lessonList .lesson-del[data-date="${ymd(20)}"]`)).toHaveCount(1);
  });

  test('せっていの「×」は上にあり、スクロールしても見えていて閉じられる', async ({ page }) => {
    await boot(page);
    await gotoHome(page);
    await openSettings(page);
    const close = page.locator('.settings-panel__close');
    await expect(close).toBeInViewport();
    const scrolled = await page.locator('#settingsMenu').evaluate((el) => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
    expect(scrolled).toBeGreaterThan(0);   // 実際にスクロールした状態で sticky を確かめる
    await expect(close).toBeInViewport();
    const box = await close.boundingBox();
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(page.locator('#settingsOverlay')).toBeHidden();
  });
});
