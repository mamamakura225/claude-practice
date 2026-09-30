import { test, expect } from '@playwright/test';

/**
 * オフライン起動（localStorage フォールバック）中の同期安全性 (#349)
 * Firebase SDK を偽モジュールに差し替え、getDoc 失敗 → 後からサーバースナップショット到着、を決定的に再現する。
 * 偽 setDoc の呼び出しは window.__fakeFs.writes に記録される。
 */

const FAKE_APP = 'export function initializeApp() { return {}; }';
const FAKE_FIRESTORE = `
const fs = (window.__fakeFs = { writes: [], listeners: [] });
export function getFirestore() { return {}; }
export function doc() { return {}; }
export function getDoc() { return Promise.reject(new Error('offline (fake)')); }
export function setDoc(_ref, data) { fs.writes.push(JSON.parse(JSON.stringify(data))); return Promise.resolve(); }
export function onSnapshot(_ref, cb) { fs.listeners.push(cb); return () => {}; }
window.__emitServerSnapshot = (data) => fs.listeners.forEach(cb => cb({
  exists: () => !!data, data: () => data, metadata: { fromCache: false },
}));
`;

function mkTask(id, title) {
  return {
    id, title, description: '', priority: 'medium', status: 'todo', deadline: '',
    categoryId: '', createdAt: '2026-09-01T00:00:00.000Z', order: 0,
    tags: [], subtasks: [], recurrence: null,
  };
}

async function openOffline(page, localTasks) {
  await page.route('**/firebasejs/*/firebase-app.js', r =>
    r.fulfill({ contentType: 'text/javascript', body: FAKE_APP }));
  await page.route('**/firebasejs/*/firebase-firestore.js', r =>
    r.fulfill({ contentType: 'text/javascript', body: FAKE_FIRESTORE }));
  await page.addInitScript((tasks) => {
    if (sessionStorage.getItem('seeded')) return; // reload では再シードしない
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('dtask_tasks', JSON.stringify(tasks));
    localStorage.setItem('dtask_categories', '[]');
    localStorage.setItem('dtask_hint_actions', '1');
  }, localTasks);
  await page.goto('/');
  await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });
  const allChip = page.locator('.preset-chip[data-preset=""]');
  await expect(async () => {
    await allChip.click();
    await expect(allChip).toHaveClass(/active/, { timeout: 500 });
  }).toPass({ timeout: 15000 });
}

async function quickAdd(page, title) {
  await page.fill('#quickAddInput', title);
  await page.press('#quickAddInput', 'Enter');
  await expect(page.locator('.task-card', { hasText: title })).toBeVisible();
}

test.describe('オフライン起動中の同期安全性 (#349)', () => {
  test('フォールバック中は操作しても online 復帰してもクラウドへ書き込まない', async ({ page }) => {
    await openOffline(page, []);
    await quickAdd(page, 'E2E_オフライン追加');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__fakeFs.writes.length)).toBe(0);
    await expect(page.locator('#syncIndicator')).toContainText('未同期');
  });

  test('フォールバック中の変更は端末に残り、リロード後も表示される', async ({ page }) => {
    await openOffline(page, []);
    await quickAdd(page, 'E2E_端末保存');
    await page.reload();
    await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });
    await page.locator('.preset-chip[data-preset=""]').click();
    await expect(page.locator('.task-card', { hasText: 'E2E_端末保存' })).toBeVisible();
  });

  test('クラウド到着時はクラウドを正とし、ローカル追加分だけ載せて書き戻す', async ({ page }) => {
    await openOffline(page, [mkTask('a', 'E2E_A_古い')]);
    await quickAdd(page, 'E2E_B_ローカル');

    await page.evaluate(({ a, c }) => window.__emitServerSnapshot({ tasks: [a, c], categories: [] }), {
      a: mkTask('a', 'E2E_A_クラウド'), c: mkTask('c', 'E2E_C_他端末'),
    });

    for (const title of ['E2E_A_クラウド', 'E2E_B_ローカル', 'E2E_C_他端末']) {
      await expect(page.locator('.task-card', { hasText: title })).toBeVisible();
    }
    await expect(page.locator('.task-card', { hasText: 'E2E_A_古い' })).toHaveCount(0);

    const writes = await page.evaluate(() => window.__fakeFs.writes);
    expect(writes).toHaveLength(1);
    expect(writes[0].tasks.map(t => t.title)).toEqual(['E2E_A_クラウド', 'E2E_C_他端末', 'E2E_B_ローカル']);
  });
});
