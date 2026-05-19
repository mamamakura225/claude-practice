import { test, expect } from '@playwright/test';

/**
 * Ctrl+Z / Cmd+Z で直近のUndoを実行できる (#34)
 * - 削除トースト消失後でも 60秒以内なら Ctrl+Z で復元可能
 * - 入力中（INPUT/TEXTAREA）はネイティブUndoに任せるためアプリのUndoは発火しない
 * - モーダル表示中は無効
 */

function seedTasks(page, tasks) {
  return page.addInitScript((data) => {
    localStorage.setItem('dtask_tasks', JSON.stringify(data));
    localStorage.setItem('dtask_categories', JSON.stringify([]));
  }, tasks);
}

const baseTask = (id, title) => ({
  id,
  title,
  priority: 'medium',
  status: 'todo',
  deadline: '',
  createdAt: '2026-05-19T09:00:00.000Z',
  order: 0,
  tags: [],
  subtasks: [],
  recurrence: null,
  categoryId: '',
});

test.describe('Ctrl+Z / Cmd+Z Undo', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('削除後 Ctrl+Z でタスクが復元される', async ({ page }) => {
    await seedTasks(page, [baseTask('t-undo-1', 'E2E_Undo_対象タスク')]);
    await page.goto('/');

    const card = page.locator('#taskList .task-card[data-id="t-undo-1"]');
    await expect(card).toBeVisible({ timeout: 10000 });

    // 削除ボタンをクリック（カード上の🗑️）
    await page.locator('.btn-action.delete[data-id="t-undo-1"]').click();
    await expect(card).toHaveCount(0, { timeout: 3000 });

    // Ctrl+Z で復元
    await page.locator('body').click();
    await page.keyboard.press('Control+z');

    await expect(card).toBeVisible({ timeout: 3000 });
    await expect(
      page.locator('#toastContainer .toast', { hasText: '元に戻しました' })
    ).toBeVisible();
  });

  test('入力中はアプリのUndoが発火しない（テキスト編集中）', async ({ page }) => {
    await seedTasks(page, [baseTask('t-undo-2', 'E2E_Undo_削除済み')]);
    await page.goto('/');

    const card = page.locator('#taskList .task-card[data-id="t-undo-2"]');
    await expect(card).toBeVisible({ timeout: 10000 });

    // 削除する → スタックに undoFn が入る
    await page.locator('.btn-action.delete[data-id="t-undo-2"]').click();
    await expect(card).toHaveCount(0, { timeout: 3000 });

    // 検索バーにフォーカスを当てて Ctrl+Z
    const search = page.locator('#searchInput');
    await search.focus();
    await search.fill('文字列');
    await page.keyboard.press('Control+z');

    // 復元されない（カードは戻ってこない）
    await expect(card).toHaveCount(0);
    // アプリのUndoトーストも出ない
    await expect(
      page.locator('#toastContainer .toast', { hasText: '元に戻しました' })
    ).toHaveCount(0);
  });

  test('連続Ctrl+Zで複数Undoできる', async ({ page }) => {
    await seedTasks(page, [
      baseTask('t-undo-3a', 'E2E_Undo_A'),
      baseTask('t-undo-3b', 'E2E_Undo_B'),
    ]);
    await page.goto('/');

    const cardA = page.locator('#taskList .task-card[data-id="t-undo-3a"]');
    const cardB = page.locator('#taskList .task-card[data-id="t-undo-3b"]');
    await expect(cardA).toBeVisible({ timeout: 10000 });
    await expect(cardB).toBeVisible();

    // 順に削除
    await page.locator('.btn-action.delete[data-id="t-undo-3a"]').click();
    await expect(cardA).toHaveCount(0, { timeout: 3000 });
    await page.locator('.btn-action.delete[data-id="t-undo-3b"]').click();
    await expect(cardB).toHaveCount(0, { timeout: 3000 });

    // 1回目のCtrl+Z → 直近に削除したB が戻る
    await page.locator('body').click();
    await page.keyboard.press('Control+z');
    await expect(cardB).toBeVisible({ timeout: 3000 });

    // 2回目のCtrl+Z → 次に古い A が戻る
    await page.keyboard.press('Control+z');
    await expect(cardA).toBeVisible({ timeout: 3000 });
  });
});
