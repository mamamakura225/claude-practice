import { test, expect } from '@playwright/test';

test.describe('検索フィルタ', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('検索バーで部分一致絞り込みができる', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#quickAddInput')).toBeVisible({ timeout: 10000 });

    const stamp = Date.now();
    const titleA = `E2E_検索A_リンゴ_${stamp}`;
    const titleB = `E2E_検索B_バナナ_${stamp}`;

    // 2件をクイック追加バーから追加
    await page.fill('#quickAddInput', titleA);
    await page.locator('#quickAddInput').press('Enter');
    await expect(page.locator('#taskList .task-card', { hasText: titleA })).toBeVisible();

    await page.fill('#quickAddInput', titleB);
    await page.locator('#quickAddInput').press('Enter');
    await expect(page.locator('#taskList .task-card', { hasText: titleB })).toBeVisible();

    // 「リンゴ」で検索
    await page.fill('#searchInput', 'リンゴ');

    // A だけ残り B は消える
    await expect(page.locator('#taskList .task-card', { hasText: titleA })).toBeVisible();
    await expect(page.locator('#taskList .task-card', { hasText: titleB })).toHaveCount(0);

    // 検索クリア
    await page.fill('#searchInput', '');
    await expect(page.locator('#taskList .task-card', { hasText: titleA })).toBeVisible();
    await expect(page.locator('#taskList .task-card', { hasText: titleB })).toBeVisible();
  });
});
