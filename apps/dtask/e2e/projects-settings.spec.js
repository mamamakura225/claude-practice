import { test, expect } from '@playwright/test';

/**
 * プロジェクト・表示設定・クイック追加チップ (#356)
 * - プロジェクトの作成 → 絞り込み → ヘッダーバッジで解除、絞り込み中の追加は自動でそのプロジェクトになる
 * - プロジェクト削除で所属タスクは「なし」へ、Undo で元に戻る
 * - テーマ・文字サイズはリロード後も保持
 * - クイック追加の「高」「明日」チップ、Shift+Enter で詳細モーダル
 */

function localDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function seed(page, tasks = [], categories = []) {
  return page.addInitScript(({ tasks, categories }) => {
    if (sessionStorage.getItem('seeded')) return; // reload では再シードしない
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('dtask_tasks', JSON.stringify(tasks));
    localStorage.setItem('dtask_categories', JSON.stringify(categories));
    localStorage.setItem('dtask_hint_actions', '1');
  }, { tasks, categories });
}

async function open(page) {
  await page.goto('/');
  await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });
  const allChip = page.locator('.preset-chip[data-preset=""]');
  await expect(async () => {
    await allChip.click();
    await expect(allChip).toHaveClass(/active/, { timeout: 500 });
  }).toPass({ timeout: 15000 });
}

const task = (id, title, over = {}) => ({
  id, title, description: '', priority: 'medium', status: 'todo', deadline: '', categoryId: '',
  createdAt: '2026-09-01T00:00:00.000Z', order: 0, tags: [], subtasks: [], recurrence: null, ...over,
});

test.describe('プロジェクト・表示設定・クイック追加チップ (#356)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('プロジェクトを作成し、絞り込み・バッジで解除・絞り込み中の追加に自動付与される', async ({ page }) => {
    await seed(page, [task('t1', 'E2E_既存')]);
    await open(page);

    await page.getByRole('button', { name: 'プロジェクトを追加' }).click();
    await page.fill('#categoryName', 'E2E_仕事');
    await page.click('#saveCategoryBtn');
    const chip = page.locator('#categoryFilter .category-chip', { hasText: 'E2E_仕事' });
    await expect(chip).toBeVisible();

    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#currentProjectBadge')).toBeVisible();
    await expect(page.locator('#currentProjectName')).toHaveText('E2E_仕事');
    await expect(page.locator('.task-card', { hasText: 'E2E_既存' })).toHaveCount(0);

    await page.fill('#quickAddInput', 'E2E_仕事のタスク');
    await page.press('#quickAddInput', 'Enter');
    const added = page.locator('.task-card', { hasText: 'E2E_仕事のタスク' });
    await expect(added).toBeVisible();
    await expect(added.locator('.badge-category')).toHaveText('E2E_仕事');

    await page.click('#currentProjectBadge');
    await expect(page.locator('#currentProjectBadge')).toBeHidden();
    await expect(page.locator('.task-card', { hasText: 'E2E_既存' })).toBeVisible();
  });

  test('プロジェクトを削除すると所属タスクは「なし」になり、Undo で元に戻る', async ({ page }) => {
    await seed(page, [task('t1', 'E2E_所属タスク', { categoryId: 'c1' })], [{ id: 'c1', name: 'E2E_消すPJ', color: '#2563EB' }]);
    await open(page);
    const card = page.locator('.task-card[data-id="t1"]');
    await expect(card.locator('.badge-category')).toHaveText('E2E_消すPJ');

    await page.getByRole('button', { name: 'プロジェクトを削除: E2E_消すPJ' }).click();
    const toast = page.locator('.toast', { hasText: '1件のタスクが「なし」になりました' });
    await expect(toast).toBeVisible();
    await expect(card.locator('.badge-category')).toHaveCount(0);
    await expect(page.locator('#categoryFilter .category-chip', { hasText: 'E2E_消すPJ' })).toHaveCount(0);

    await toast.getByRole('button', { name: '元に戻す' }).click();
    await expect(card.locator('.badge-category')).toHaveText('E2E_消すPJ');
    await expect(page.locator('#categoryFilter .category-chip', { hasText: 'E2E_消すPJ' })).toBeVisible();
  });

  test('テーマと文字サイズはリロード後も保持される', { tag: '@compat' }, async ({ page }) => {
    await seed(page);
    await open(page);
    await page.click('#themeToggleBtn');
    await page.locator('.fontsize-btn[data-fontsize="large"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveAttribute('data-fontsize', 'large');

    await page.reload();
    await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveAttribute('data-fontsize', 'large');
    await expect(page.locator('#themeToggleBtn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.fontsize-btn[data-fontsize="large"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('クイック追加の「高」「明日」チップが優先度と期限に反映される', async ({ page }) => {
    await seed(page);
    await open(page);
    await page.locator('.quick-add-chip[data-meta="priority-high"]').click();
    await page.locator('.quick-add-chip[data-meta="deadline-tomorrow"]').click();
    await expect(page.locator('.quick-add-chip[data-meta="priority-high"]')).toHaveAttribute('aria-pressed', 'true');
    await page.fill('#quickAddInput', 'E2E_高明日');
    await page.press('#quickAddInput', 'Enter');

    const card = page.locator('.task-card', { hasText: 'E2E_高明日' });
    await expect(card.locator('.badge-high')).toHaveText('高');
    await expect(card).toContainText(localDay(1).replaceAll('-', '/'));
  });

  test('Shift+Enter で詳細モーダルが開き、タイトルとチップの値が引き継がれる', async ({ page }) => {
    await seed(page);
    await open(page);
    await page.locator('.quick-add-chip[data-meta="priority-high"]').click();
    await page.fill('#quickAddInput', 'E2E_詳細へ');
    await page.press('#quickAddInput', 'Shift+Enter');

    await expect(page.locator('#taskModal')).toBeVisible();
    await expect(page.locator('#taskTitle')).toHaveValue('E2E_詳細へ');
    await expect(page.locator('#taskPriority')).toHaveValue('high');
    await expect(page.locator('#quickAddInput')).toHaveValue('');
  });
});
