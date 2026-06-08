import { test, expect } from '@playwright/test';

/**
 * サブタスクのインライン操作 E2E (#25)
 * - 既存 subtasks.spec.js はモーダル経由の追加を確認するもの。本 spec は
 *   カード上のインラインボタン（add-subtask-empty / add-subtask / toggle-subtask /
 *   edit-subtask）の挙動をカバーする。
 * - localStorage に直接 seed して Firestore は abort。
 */

function seedTasks(page, tasks) {
  return page.addInitScript((data) => {
    localStorage.setItem('dtask_tasks', JSON.stringify(data));
    localStorage.setItem('dtask_categories', JSON.stringify([]));
  }, tasks);
}

// 起動既定が「今日」フィルタ(#33)のため、全タスク表示前提のテストは「すべて」へ切替える
async function showAll(page) {
  const allChip = page.locator('.preset-chip[data-preset=""]');
  await expect(async () => {
    await allChip.click();
    await expect(allChip).toHaveClass(/active/, { timeout: 500 });
  }).toPass({ timeout: 15000 });
}

function baseTask(overrides = {}) {
  return {
    id: 'task-sub',
    title: 'E2E_インライン_親タスク',
    priority: 'medium',
    status: 'todo',
    deadline: '',
    createdAt: '2026-05-19T09:00:00.000Z',
    order: 0,
    tags: [],
    subtasks: [],
    recurrence: null,
    categoryId: '',
    ...overrides,
  };
}

test.describe('サブタスク インライン操作', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('0件タスクから「＋ サブタスク」でインライン追加できる', async ({ page }) => {
    await seedTasks(page, [baseTask({ subtasks: [] })]);
    await page.goto('/');
    await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });
    await showAll(page);

    const card = page.locator('#taskList .task-card[data-id="task-sub"]');
    await expect(card).toBeVisible();

    // 0件導線ボタン → クリックでカードが展開 + 入力欄が自動表示
    await card.locator('[data-action="add-subtask-empty"]').click();
    const input = card.locator('input.subtask-inline-add-input');
    await expect(input).toBeVisible();
    await input.fill('インライン追加サブタスク');
    await input.press('Enter');

    // 追加後、進捗バッジが 0/1 に
    await expect(card).toContainText('0/1');
    // インライン行に追加したタイトルが表示
    await expect(
      card.locator('.subtask-inline-row .subtask-inline-title', {
        hasText: 'インライン追加サブタスク',
      })
    ).toBeVisible();
  });

  test('インラインのチェックボックスで進捗が 0/2 → 1/2 → 2/2 に更新される', async ({ page }) => {
    await seedTasks(page, [
      baseTask({
        subtasks: [
          { id: 's1', title: 'サブA', done: false },
          { id: 's2', title: 'サブB', done: false },
        ],
      }),
    ]);
    await page.goto('/');
    await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });
    await showAll(page);

    const card = page.locator('#taskList .task-card[data-id="task-sub"]');
    await expect(card).toContainText('0/2');

    // 展開
    await card.locator('[data-action="toggle-subtasks"]').click();

    // s1 をチェック
    await card
      .locator('input.subtask-inline-check[data-sid="s1"]')
      .check();
    await expect(card).toContainText('1/2');

    // s2 もチェック
    await card
      .locator('input.subtask-inline-check[data-sid="s2"]')
      .check();
    await expect(card).toContainText('2/2');

    // s1 をアンチェックして戻る
    await card
      .locator('input.subtask-inline-check[data-sid="s1"]')
      .uncheck();
    await expect(card).toContainText('1/2');
  });

  test('インラインでサブタスクのタイトルを編集できる', async ({ page }) => {
    await seedTasks(page, [
      baseTask({
        subtasks: [{ id: 's1', title: '旧タイトル', done: false }],
      }),
    ]);
    await page.goto('/');
    await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });
    await showAll(page);

    const card = page.locator('#taskList .task-card[data-id="task-sub"]');
    // 展開
    await card.locator('[data-action="toggle-subtasks"]').click();

    // タイトルクリック → input に変わる
    await card.locator('[data-action="edit-subtask"][data-sid="s1"]').click();
    const editInput = card.locator('input.subtask-inline-edit');
    await expect(editInput).toBeVisible();
    await expect(editInput).toHaveValue('旧タイトル');

    await editInput.fill('新タイトル');
    await editInput.press('Enter');

    // 編集後、新タイトルが表示
    await expect(
      card.locator('.subtask-inline-row .subtask-inline-title', {
        hasText: '新タイトル',
      })
    ).toBeVisible();
    // 旧タイトルは消えている
    await expect(
      card.locator('.subtask-inline-row .subtask-inline-title', {
        hasText: '旧タイトル',
      })
    ).toHaveCount(0);
  });
});
