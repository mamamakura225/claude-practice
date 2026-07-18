import { test, expect } from '@playwright/test';

// 練習カレンダー（月間ヒートマップ・#236）。きろく画面に月表示・濃淡・月移動が出る。
test.describe('練習カレンダー（#236）', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    });
  });

  test('きろく画面にカレンダーが表示され、前月・翌月へ移動できる', async ({ page }) => {
    await page.goto('/#/history');
    await expect(page.locator('#view-history')).toBeVisible({ timeout: 10000 });

    // カレンダーが描画され、日セルが1つ以上ある
    const calendar = page.locator('#practiceCalendar');
    await expect(calendar).toBeVisible();
    await expect(page.locator('#calGrid .cal-cell:not(.cal-cell--pad)').first()).toBeVisible();

    // 現在の月タイトル（YYYY年M月）
    const title0 = await page.locator('#calTitle').textContent();
    expect(title0).toMatch(/^\d{4}年\d{1,2}月$/);

    // 前月へ → タイトルが変わる
    await page.click('#calPrevBtn');
    const titlePrev = await page.locator('#calTitle').textContent();
    expect(titlePrev).not.toBe(title0);
    expect(titlePrev).toMatch(/^\d{4}年\d{1,2}月$/);

    // 翌月へ2回 → 元の翌月
    await page.click('#calNextBtn');
    await page.click('#calNextBtn');
    const titleNext = await page.locator('#calTitle').textContent();
    expect(titleNext).not.toBe(title0);
  });
});
