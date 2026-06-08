import { test, expect } from '@playwright/test';

/**
 * 「今日やること」ホームビュー E2E (#33)
 * - 起動時に「今日」フィルタON（今日締切＋期限切れ未完了）で開く
 * - ビュー形式（List/Kanban）は localStorage `dtask_view` から復元（preset は毎回 today 固定）
 * - 今日対象が全て完了 → 達成（ご褒美）空状態 #todayDoneState を表示し両ビューを隠す
 */

function isoDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function mkTask(over = {}) {
  return {
    id: 'x', title: 'x', priority: 'medium', status: 'todo', deadline: '',
    createdAt: '2026-05-19T09:00:00.000Z', order: 0,
    tags: [], subtasks: [], recurrence: null, categoryId: '', ...over,
  };
}

function seed(page, tasks, extra = {}) {
  return page.addInitScript(({ data, extra }) => {
    localStorage.setItem('dtask_tasks', JSON.stringify(data));
    localStorage.setItem('dtask_categories', JSON.stringify([]));
    Object.entries(extra).forEach(([k, v]) => localStorage.setItem(k, v));
  }, { data: tasks, extra });
}

test.describe('今日やること ホームビュー (#33)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('起動時に「今日」フィルタONで開く（今日締切＋期限切れ未完了のみ表示）', async ({ page }) => {
    await seed(page, [
      mkTask({ id: 't-today',   title: 'E2E_今日',     deadline: isoDay(0) }),
      mkTask({ id: 't-overdue', title: 'E2E_期限切れ', deadline: isoDay(-1) }),
      mkTask({ id: 't-future',  title: 'E2E_未来',     deadline: isoDay(3) }),
    ]);
    await page.goto('/');
    await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });

    // 「今日」chip が active
    await expect(page.locator('.preset-chip[data-preset="today"]')).toHaveClass(/active/);

    // 今日＋期限切れは表示、未来は非表示
    await expect(page.locator('#taskList .task-card[data-id="t-today"]')).toBeVisible();
    await expect(page.locator('#taskList .task-card[data-id="t-overdue"]')).toBeVisible();
    await expect(page.locator('#taskList .task-card[data-id="t-future"]')).toHaveCount(0);

    // 「すべて」で未来も表示される
    await page.locator('.preset-chip[data-preset=""]').click();
    await expect(page.locator('#taskList .task-card[data-id="t-future"]')).toBeVisible();
  });

  test('ビュー形式（Kanban）が localStorage から復元される', async ({ page }) => {
    await seed(page, [mkTask({ id: 't-k', title: 'E2E_K', deadline: isoDay(0) })], {
      dtask_view: 'kanban',
    });
    await page.goto('/');
    await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('#kanbanView')).toBeVisible();
    await expect(page.locator('#listView')).toBeHidden();
    await expect(page.locator('#kanbanViewBtn')).toHaveClass(/active/);
  });

  test('今日のタスクを全て完了するとご褒美空状態が出る', async ({ page }) => {
    await seed(page, [
      mkTask({ id: 't-done',   title: 'E2E_完了済み', deadline: isoDay(0), status: 'done' }),
      mkTask({ id: 't-next',   title: 'E2E_次の締切', deadline: isoDay(2) }),
    ]);
    await page.goto('/');
    await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });

    const reward = page.locator('#todayDoneState');
    await expect(reward).toBeVisible();
    await expect(reward).toContainText('今日のタスクは完了');
    await expect(reward).toContainText('次の締切');
    await expect(page.locator('#listView')).toBeHidden();
    await expect(page.locator('#kanbanView')).toBeHidden();
  });
});
