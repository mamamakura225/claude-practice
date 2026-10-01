import { test, expect } from '@playwright/test';

/**
 * 表示崩れの退行防止 (#353)
 * - 狭い幅でもヘッダーのボタンが画面内に収まり、ロゴが折り返さない
 * - プロジェクト管理欄の色ドットが円のまま
 * - モバイルKanbanの列幅が画面を超えない（長いカードでも）
 * - ステータスバッジが優先度「低」と別の見た目
 */

const LONG = 'とても長いタイトルのタスクで列の幅が中身に引きずられないことを確かめる';

function seed(page, extra = {}) {
  return page.addInitScript(({ long, extra }) => {
    const t = (id, title, over = {}) => ({
      id, title, description: '', priority: 'low', status: 'todo', deadline: '2026-09-28', categoryId: 'c1',
      createdAt: '2026-09-01T00:00:00.000Z', order: 0, tags: ['タグ'], subtasks: [{ id: 's', title: 's', done: false }],
      recurrence: { type: 'daily' }, ...over,
    });
    localStorage.setItem('dtask_tasks', JSON.stringify([t('a', long), t('b', 'B', { status: 'inprogress' })]));
    localStorage.setItem('dtask_categories', JSON.stringify([{ id: 'c1', name: 'プライベートプロジェクト', color: '#16A34A' }]));
    localStorage.setItem('dtask_hint_actions', '1');
    Object.entries(extra).forEach(([k, v]) => localStorage.setItem(k, v));
  }, { long: LONG, extra });
}

async function open(page) {
  await page.goto('/');
  await expect(page.locator('#quickAddInput')).toBeVisible({ timeout: 10000 });
  const allChip = page.locator('.preset-chip[data-preset=""]');
  await expect(async () => {
    await allChip.click();
    await expect(allChip).toHaveClass(/active/, { timeout: 500 });
  }).toPass({ timeout: 15000 });
}

test.describe('表示崩れの退行防止 (#353)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  for (const width of [320, 390]) {
    test(`幅${width}px：ヘッダーが画面内に収まりロゴが1行`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await seed(page);
      await open(page);
      // はみ出しの元凶だった「未同期」表示が出ている状態で測る
      await expect(page.locator('#syncIndicator')).toHaveClass(/sync-local/);
      const m = await page.evaluate(() => ({
        help: document.getElementById('shortcutsHelpBtn').getBoundingClientRect().right,
        logoH: document.querySelector('.logo').getBoundingClientRect().height,
        scrollW: document.documentElement.scrollWidth,
      }));
      expect(m.help).toBeLessThanOrEqual(width);
      expect(m.scrollW).toBeLessThanOrEqual(width);
      expect(m.logoH).toBeLessThan(40);
    });
  }

  test('プロジェクト管理欄の色ドットは円のまま', async ({ page }) => {
    await seed(page);
    await open(page);
    const box = await page.locator('#categoryList .category-dot').first().boundingBox();
    expect(Math.round(box.width)).toBe(Math.round(box.height));
  });

  test('モバイルKanbanの列は長いカードでも画面幅を超えない', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await seed(page, { dtask_view: 'kanban' });
    await open(page);
    await expect(page.locator('.kanban-card', { hasText: LONG })).toBeVisible();
    const colW = await page.locator('.kanban-column').first().evaluate(e => e.getBoundingClientRect().width);
    expect(colW).toBeLessThan(390 - 24);
  });

  test('ステータスバッジは優先度「低」と別のクラス・見た目', async ({ page }) => {
    await seed(page);
    await open(page);
    const status = page.locator('.task-card[data-id="a"] .badge-status');
    await expect(status).toHaveText('未着手');
    await expect(status).not.toHaveClass(/badge-low/);
    const look = (sel) => page.evaluate((sel) => {
      const cs = getComputedStyle(document.querySelector(sel));
      return [cs.backgroundColor, cs.borderTopColor];
    }, sel);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => { document.body.dataset.theme = t; }, theme);
      expect(await look('.task-card[data-id="a"] .badge-status')).not.toEqual(await look('.task-card[data-id="a"] .badge-low'));
    }
  });
});
