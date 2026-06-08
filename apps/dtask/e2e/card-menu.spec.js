import { test, expect } from '@playwright/test';

/**
 * カード操作メニュー（⋮）E2E (#111)
 * - ドラッグ/スワイプ非依存で 移動・ステータス・削除 をタップ／キーボードで実行
 * - 起動既定の「今日」フィルタで見えるよう seed は今日締切にする
 */

function isoDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function mkTask(id, title, order) {
  return {
    id, title, priority: 'medium', status: 'todo', deadline: isoDay(0),
    createdAt: '2026-05-19T09:00:00.000Z', order,
    tags: [], subtasks: [], recurrence: null, categoryId: '',
  };
}

function seedTasks(page, tasks) {
  return page.addInitScript((data) => {
    localStorage.setItem('dtask_tasks', JSON.stringify(data));
    localStorage.setItem('dtask_categories', JSON.stringify([]));
    localStorage.setItem('dtask_hint_actions', '1'); // 初回ヒントは抑止
  }, tasks);
}

test.describe('カード操作メニュー (#111)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('⋮ メニューから削除できる（スワイプ非依存）', async ({ page }) => {
    await seedTasks(page, [mkTask('t-a', 'E2E_A', 0), mkTask('t-b', 'E2E_B', 1)]);
    await page.goto('/');
    const cardA = page.locator('#taskList .task-card[data-id="t-a"]');
    await expect(cardA).toBeVisible({ timeout: 10000 });

    await cardA.locator('.card-menu-btn').click();
    const menu = page.locator('#cardMenu');
    await expect(menu).toBeVisible();
    await menu.locator('.card-menu-item', { hasText: '削除' }).click();

    await expect(cardA).toHaveCount(0, { timeout: 3000 });
    await expect(page.locator('#toastContainer .toast', { hasText: '削除しました' })).toBeVisible();
  });

  test('⋮ メニューの「下へ」で並び替えできる', async ({ page }) => {
    await seedTasks(page, [mkTask('t-a', 'E2E_A', 0), mkTask('t-b', 'E2E_B', 1)]);
    await page.goto('/');
    await expect(page.locator('#taskList .task-card[data-id="t-a"]')).toBeVisible({ timeout: 10000 });

    // 初期は A が先頭
    await expect(page.locator('#taskList .task-card').first()).toHaveAttribute('data-id', 't-a');

    await page.locator('.task-card[data-id="t-a"] .card-menu-btn').click();
    await page.locator('#cardMenu .card-menu-item', { hasText: '下へ' }).click();

    // A が B の下へ → 先頭が B
    await expect(page.locator('#taskList .task-card').first()).toHaveAttribute('data-id', 't-b');
  });

  test('⋮ メニューの「完了にする」でステータス変更できる', async ({ page }) => {
    await seedTasks(page, [mkTask('t-a', 'E2E_A', 0), mkTask('t-b', 'E2E_B', 1)]);
    await page.goto('/');
    const cardA = page.locator('#taskList .task-card[data-id="t-a"]');
    await expect(cardA).toBeVisible({ timeout: 10000 });

    await cardA.locator('.card-menu-btn').click();
    await page.locator('#cardMenu .card-menu-item', { hasText: '完了にする' }).click();

    // 今日締切は完了済みも表示に残る → done-card になる
    await expect(cardA).toHaveClass(/done-card/);
  });

  test('キーボードでメニューを開閉できる', async ({ page }) => {
    await seedTasks(page, [mkTask('t-a', 'E2E_A', 0), mkTask('t-b', 'E2E_B', 1)]);
    await page.goto('/');
    const kebab = page.locator('.task-card[data-id="t-a"] .card-menu-btn');
    await expect(kebab).toBeVisible({ timeout: 10000 });

    await kebab.focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('#cardMenu');
    await expect(menu).toBeVisible();
    // 最初の有効項目にフォーカスが移る
    await expect(menu.locator('.card-menu-item:not([disabled])').first()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(kebab).toBeFocused();
  });
});
