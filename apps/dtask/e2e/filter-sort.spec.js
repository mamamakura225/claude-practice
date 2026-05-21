import { test, expect } from '@playwright/test';

/**
 * フィルタ・ソート切替の E2E (#25)
 * - localStorage に直接 seed → Firestore は abort して loadStorage を localStorage 経由に落とす
 * - サイドバーの statusFilter / priorityFilter / sortOrder / preset-chip をカバー
 */

function isoDay(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function seedTasks(page, tasks) {
  return page.addInitScript((data) => {
    localStorage.setItem('dtask_tasks', JSON.stringify(data));
    localStorage.setItem('dtask_categories', JSON.stringify([]));
  }, tasks);
}

test.describe('フィルタ・ソート切替', () => {
  const today = isoDay(0);
  const yesterday = isoDay(-1);

  // 4件のタスクを用意（id でカード一致を取れるようにユニーク title を付与）
  const tasks = [
    {
      id: 't-high-todo-today',
      title: 'E2E_高_未着手_今日',
      priority: 'high',
      status: 'todo',
      deadline: today,
      createdAt: '2026-05-19T09:00:00.000Z',
      order: 0,
      tags: [],
      subtasks: [],
      recurrence: null,
      categoryId: '',
    },
    {
      id: 't-mid-inprogress',
      title: 'E2E_中_進行中',
      priority: 'medium',
      status: 'inprogress',
      deadline: '',
      createdAt: '2026-05-19T10:00:00.000Z',
      order: 1,
      tags: [],
      subtasks: [],
      recurrence: null,
      categoryId: '',
    },
    {
      id: 't-low-done',
      title: 'E2E_低_完了',
      priority: 'low',
      status: 'done',
      deadline: '',
      createdAt: '2026-05-19T11:00:00.000Z',
      order: 2,
      tags: [],
      subtasks: [],
      recurrence: null,
      categoryId: '',
    },
    {
      id: 't-mid-overdue',
      title: 'E2E_中_期限切れ',
      priority: 'medium',
      status: 'todo',
      deadline: yesterday,
      createdAt: '2026-05-19T12:00:00.000Z',
      order: 3,
      tags: [],
      subtasks: [],
      recurrence: null,
      categoryId: '',
    },
  ];

  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await seedTasks(page, tasks);
    await page.goto('/');
    await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });
    // 4 件のカードがレンダリングされた状態を待つ
    await expect(page.locator('#taskList .task-card')).toHaveCount(4);
  });

  test('ステータスフィルタで「進行中」のみに絞り込める', async ({ page }) => {
    await page.selectOption('#statusFilter', 'inprogress');
    await expect(page.locator('#taskList .task-card')).toHaveCount(1);
    await expect(
      page.locator('#taskList .task-card', { hasText: 'E2E_中_進行中' })
    ).toBeVisible();

    // 「すべて」に戻すと 4 件に復帰
    await page.selectOption('#statusFilter', '');
    await expect(page.locator('#taskList .task-card')).toHaveCount(4);
  });

  test('優先度フィルタで「高」のみに絞り込める', async ({ page }) => {
    await page.selectOption('#priorityFilter', 'high');
    await expect(page.locator('#taskList .task-card')).toHaveCount(1);
    await expect(
      page.locator('#taskList .task-card', { hasText: 'E2E_高_未着手_今日' })
    ).toBeVisible();

    await page.selectOption('#priorityFilter', '');
    await expect(page.locator('#taskList .task-card')).toHaveCount(4);
  });

  test('並べ替えを「優先度順」に切替えるとカード順が変わる', async ({ page }) => {
    // 完了タスクは末尾固定なので、優先度順では high → medium → medium → done(low)
    await page.selectOption('#sortOrder', 'priority');

    const firstCard = page.locator('#taskList .task-card').first();
    await expect(firstCard).toContainText('E2E_高_未着手_今日');

    const lastCard = page.locator('#taskList .task-card').last();
    await expect(lastCard).toContainText('E2E_低_完了');
  });

  test('期限プリセット「期限切れ」で当日より前の todo のみに絞り込める', async ({ page }) => {
    await page.locator('.preset-chip[data-preset="overdue"]').click();
    await expect(page.locator('#taskList .task-card')).toHaveCount(1);
    await expect(
      page.locator('#taskList .task-card', { hasText: 'E2E_中_期限切れ' })
    ).toBeVisible();

    // 「今日」に切替えると本日締切の高タスクに変わる
    await page.locator('.preset-chip[data-preset="today"]').click();
    await expect(page.locator('#taskList .task-card')).toHaveCount(1);
    await expect(
      page.locator('#taskList .task-card', { hasText: 'E2E_高_未着手_今日' })
    ).toBeVisible();
  });
});
