import { test, expect } from '@playwright/test';

test.describe('サブタスク', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('詳細モーダルでサブタスクを2件追加でき、カードに進捗が表示される', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });

    // モーダル開く（init待ち）
    await expect(async () => {
      await page.click('#addTaskBtn');
      await expect(page.locator('#taskModal')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });

    const uniqueTitle = `E2E_サブタスク_${Date.now()}`;
    await page.fill('#taskTitle', uniqueTitle);

    // サブタスクを2件追加
    await page.click('#addSubtaskBtn');
    await page.locator('#subtaskList .subtask-title-input').nth(0).fill('サブタスク1');

    await page.click('#addSubtaskBtn');
    await page.locator('#subtaskList .subtask-title-input').nth(1).fill('サブタスク2');

    // 保存
    await page.locator('#taskForm button[type="submit"]').click();
    await expect(page.locator('#taskModal')).toBeHidden();

    // カードに進捗（0/2）が表示される
    const card = page.locator('#taskList .task-card', { hasText: uniqueTitle });
    await expect(card).toBeVisible();
    await expect(card).toContainText('0/2');
  });
});
