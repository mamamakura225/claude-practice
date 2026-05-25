import { test, expect } from '@playwright/test';

/**
 * Kanban フルサイクル E2E (#25)
 * - 既存 kanban.spec.js は todo→inprogress のみカバー。本 spec は todo→inprogress→done の
 *   全サイクルと、各ステータスでカードが対応する列に移動することを検証する。
 * - 列構成: #todoCards / #inprogressCards / #doneCards
 */

function seedTasks(page, tasks) {
  return page.addInitScript((data) => {
    localStorage.setItem('dtask_tasks', JSON.stringify(data));
    localStorage.setItem('dtask_categories', JSON.stringify([]));
  }, tasks);
}

test.describe('Kanban フルサイクル', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('todo → inprogress → done と切替えるとカードが対応する列へ移動する', { tag: '@compat' }, async ({ page }) => {
    await seedTasks(page, [
      {
        id: 't-kanban',
        title: 'E2E_Kanban_全サイクル',
        priority: 'medium',
        status: 'todo',
        deadline: '',
        createdAt: '2026-05-19T09:00:00.000Z',
        order: 0,
        tags: [],
        subtasks: [],
        recurrence: null,
        categoryId: '',
      },
    ]);
    await page.goto('/');
    await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });

    // Kanban に切替
    await page.click('#kanbanViewBtn');
    await expect(page.locator('#kanbanView')).toBeVisible();

    // 初期: todo 列にカードあり
    await expect(
      page.locator('#todoCards .kanban-card[data-id="t-kanban"]')
    ).toBeVisible();
    await expect(
      page.locator('#inprogressCards .kanban-card[data-id="t-kanban"]')
    ).toHaveCount(0);

    // todo → inprogress
    await page
      .locator('.kanban-card[data-id="t-kanban"] .kanban-status-select')
      .selectOption('inprogress');
    await expect(
      page.locator('#inprogressCards .kanban-card[data-id="t-kanban"]')
    ).toBeVisible();
    await expect(
      page.locator('#todoCards .kanban-card[data-id="t-kanban"]')
    ).toHaveCount(0);

    // inprogress → done
    await page
      .locator('.kanban-card[data-id="t-kanban"] .kanban-status-select')
      .selectOption('done');
    await expect(
      page.locator('#doneCards .kanban-card[data-id="t-kanban"]')
    ).toBeVisible();
    await expect(
      page.locator('#inprogressCards .kanban-card[data-id="t-kanban"]')
    ).toHaveCount(0);

    // done → todo へ戻せる
    await page
      .locator('.kanban-card[data-id="t-kanban"] .kanban-status-select')
      .selectOption('todo');
    await expect(
      page.locator('#todoCards .kanban-card[data-id="t-kanban"]')
    ).toBeVisible();
    await expect(
      page.locator('#doneCards .kanban-card[data-id="t-kanban"]')
    ).toHaveCount(0);
  });
});
