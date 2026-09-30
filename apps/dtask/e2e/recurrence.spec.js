import { test, expect } from '@playwright/test';

/**
 * 繰り返しタスク (#351)
 * - どの経路で完了にしても次回分が1件だけ生成される（✓ / ⋮ / Kanbanセレクト / Kanban D&D / 編集モーダル）
 * - 完了→未完了→完了で重複生成しない
 * - スキップは今回分を外して次回分を残す（既に次回分があれば作らない）
 */

const TITLE = 'E2E_毎日R';

function seed(page, tasks, extra = {}) {
  return page.addInitScript(({ data, extra }) => {
    localStorage.setItem('dtask_tasks', JSON.stringify(data));
    localStorage.setItem('dtask_categories', JSON.stringify([]));
    localStorage.setItem('dtask_hint_actions', '1');
    Object.entries(extra).forEach(([k, v]) => localStorage.setItem(k, v));
  }, { data: tasks, extra });
}

function recurring(over = {}) {
  return {
    id: 'r', title: TITLE, description: '', priority: 'medium', status: 'todo',
    deadline: '2026-09-30', categoryId: '', createdAt: '2026-09-01T00:00:00.000Z', order: 0,
    tags: [], subtasks: [], recurrence: { type: 'daily' }, ...over,
  };
}

async function open(page, view = 'list') {
  await seed(page, [recurring()], { dtask_view: view });
  await page.goto('/');
  await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });
  const allChip = page.locator('.preset-chip[data-preset=""]');
  await expect(async () => {
    await allChip.click();
    await expect(allChip).toHaveClass(/active/, { timeout: 500 });
  }).toPass({ timeout: 15000 });
}

const cards = (page, view) =>
  page.locator(view === 'kanban' ? '.kanban-card' : '#taskList .task-card', { hasText: TITLE });

async function expectNextSpawned(page, view) {
  await expect(cards(page, view)).toHaveCount(2);
  await expect(cards(page, view).filter({ hasText: '2026/10/01' })).toHaveCount(1);
}

test.describe('繰り返しタスク (#351)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('✓ボタンで完了にすると次回分が1件できる', async ({ page }) => {
    await open(page);
    await page.locator('.task-card[data-id="r"] .task-check').click();
    await expectNextSpawned(page, 'list');
  });

  test('⋮メニューの「完了にする」で次回分が1件できる', async ({ page }) => {
    await open(page);
    await page.locator('.task-card[data-id="r"] .card-menu-btn').click();
    await page.locator('.card-menu-item', { hasText: '完了にする' }).click();
    await expectNextSpawned(page, 'list');
  });

  test('Kanban のステータスセレクトで完了にすると次回分が1件できる', async ({ page }) => {
    await open(page, 'kanban');
    await page.selectOption('#kanban-status-r', 'done');
    await expectNextSpawned(page, 'kanban');
  });

  test('Kanban で完了列へドラッグすると次回分が1件できる', async ({ page }) => {
    await open(page, 'kanban');
    await page.locator('.kanban-card[data-id="r"] .kanban-card-title').dragTo(page.locator('#doneCards'));
    await expect(page.locator('#doneCards .kanban-card[data-id="r"]')).toBeVisible();
    await expectNextSpawned(page, 'kanban');
  });

  test('編集モーダルでステータスを完了にして保存すると次回分が1件できる', async ({ page }) => {
    await open(page);
    await page.locator('.task-card[data-id="r"] [data-action="edit"]').click({ force: true });
    await page.selectOption('#taskStatus', 'done');
    await page.locator('#taskForm button[type="submit"]').click();
    await expectNextSpawned(page, 'list');
  });

  test('完了→未完了→完了と切替えても次回分は重複しない', async ({ page }) => {
    await open(page);
    const check = page.locator('.task-card[data-id="r"] .task-check');
    await check.click();
    await expect(cards(page, 'list')).toHaveCount(2);
    await check.click();
    await check.click();
    await expect(cards(page, 'list')).toHaveCount(2);
  });

  test('スキップは今回分を外し、次回分だけ残す（完了→未完了後のスキップでも1件）', async ({ page }) => {
    await open(page);
    const check = page.locator('.task-card[data-id="r"] .task-check');
    await check.click();
    await check.click(); // 未完了へ戻す（次回分は既にある）
    await page.locator('.task-card[data-id="r"] [data-action="skip"]').click({ force: true });
    await expect(page.locator('.task-card[data-id="r"]')).toHaveCount(0);
    await expect(cards(page, 'list')).toHaveCount(1);
    await expect(cards(page, 'list')).toContainText('2026/10/01');
  });
});
