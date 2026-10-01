import { test, expect } from '@playwright/test';

/**
 * 今日ビューからの追加 (#352)
 * - 起動既定の「今日」ビューでクイック追加すると期限=今日で追加され、そのまま見える
 * - 絞り込みで見えないタスクを追加したら、理由と「すべて表示」導線をトーストで出す
 */

function localDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function open(page) {
  await page.addInitScript(() => {
    localStorage.setItem('dtask_tasks', '[]');
    localStorage.setItem('dtask_categories', '[]');
    localStorage.setItem('dtask_hint_actions', '1');
  });
  await page.goto('/');
  await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });
  // init() 完了（今日 chip の active 反映）を待つ
  await expect(page.locator('.preset-chip[data-preset="today"]')).toHaveClass(/active/);
}

test.describe('今日ビューからの追加 (#352)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('今日ビューのクイック追加は期限=今日で追加され、そのまま表示される', async ({ page }) => {
    await open(page);
    await expect(page.locator('#quickAddInput')).toHaveAttribute('placeholder', /今日/);
    await page.fill('#quickAddInput', 'E2E_今日追加');
    await page.press('#quickAddInput', 'Enter');
    const card = page.locator('#taskList .task-card', { hasText: 'E2E_今日追加' });
    await expect(card).toBeVisible();
    await expect(card).toContainText(localDay(0).replaceAll('-', '/'));
    await expect(page.locator('.toast', { hasText: '今の絞り込みでは表示されません' })).toHaveCount(0);
    await expect(page.locator('#quickAddInput')).toHaveAttribute('aria-label', /期限は今日/);
  });

  test('今日ビューで詳細モーダルを開くと期限に今日が入っている', async ({ page }) => {
    await open(page);
    await page.click('#addTaskBtn');
    await expect(page.locator('#taskDeadline')).toHaveValue(localDay(0));
  });

  test('絞り込みで見えないタスクを追加すると通知し、「すべて表示」で見えるようになる', async ({ page }) => {
    await open(page);
    await page.locator('.preset-chip[data-preset="overdue"]').click();
    await page.fill('#searchInput', 'E2E_検索語');
    await expect(page.locator('#quickAddInput')).not.toHaveAttribute('placeholder', /今日/);
    await page.fill('#quickAddInput', 'E2E_見えない追加');
    await page.press('#quickAddInput', 'Enter');

    const toast = page.locator('.toast', { hasText: '今の絞り込みでは表示されません' });
    await expect(toast).toBeVisible();
    await expect(page.locator('#taskList .task-card', { hasText: 'E2E_見えない追加' })).toHaveCount(0);

    await toast.getByRole('button', { name: 'すべて表示' }).click();
    await expect(page.locator('#taskList .task-card', { hasText: 'E2E_見えない追加' })).toBeVisible();
    await expect(page.locator('.preset-chip[data-preset=""]')).toHaveClass(/active/);
    await expect(page.locator('.preset-chip[data-preset=""]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#searchInput')).toHaveValue('');
  });

  test('トーストはフォーカス中は消えない', async ({ page }) => {
    await open(page);
    await page.locator('.preset-chip[data-preset="overdue"]').click();
    await page.fill('#quickAddInput', 'E2E_フォーカス保持');
    await page.press('#quickAddInput', 'Enter');
    const btn = page.locator('.toast').getByRole('button', { name: 'すべて表示' });
    await btn.focus();
    await page.waitForTimeout(7600);
    await expect(btn).toBeVisible();
  });
});
