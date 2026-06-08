import { test, expect } from '@playwright/test';

// 起動既定が「今日」フィルタ(#33)のため、全タスク表示前提のテストは「すべて」へ切替える
async function showAll(page) {
  const allChip = page.locator('.preset-chip[data-preset=""]');
  await expect(async () => {
    await allChip.click();
    await expect(allChip).toHaveClass(/active/, { timeout: 500 });
  }).toPass({ timeout: 15000 });
}

test.describe('Kanban ビュー', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('Kanban に切り替えてステータスを inprogress に変更できる', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });
    await showAll(page);

    // タスクを1件作成
    await expect(async () => {
      await page.click('#addTaskBtn');
      await expect(page.locator('#taskModal')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });

    const uniqueTitle = `E2E_Kanban_${Date.now()}`;
    await page.fill('#taskTitle', uniqueTitle);
    await page.locator('#taskForm button[type="submit"]').click();
    await expect(page.locator('#taskModal')).toBeHidden();

    // Kanban に切り替え
    await page.click('#kanbanViewBtn');
    await expect(page.locator('#kanbanView')).toBeVisible();
    await expect(page.locator('#listView')).toBeHidden();

    // 作成したタスクが Kanban カードに出ている
    const card = page.locator('#kanbanView .kanban-card', { hasText: uniqueTitle });
    await expect(card).toBeVisible();

    // ステータスを inprogress に変更
    await card.locator('.kanban-status-select').selectOption('inprogress');

    // inprogress 列に移動していることを確認
    const inprogressCol = page.locator('#kanbanView .kanban-column').nth(1);
    await expect(inprogressCol.locator('.kanban-card', { hasText: uniqueTitle })).toBeVisible();
  });
});
