import { test, expect } from '@playwright/test';

/**
 * アクセシビリティ (#354)
 * - 表示中の文字のコントラストがライト/ダークとも WCAG AA（4.5:1、大きい文字 3:1）
 * - モバイルのタップ領域が 32px 以上
 * - プロジェクト追加ボタンの読み上げ名、期限プリセットはトグルボタン（aria-pressed）
 * - モーダルを閉じたら開いたボタンへフォーカスが戻る
 * - 同期表示：送信が終わらないと「送信待ち」、保存失敗は回線の出入りで消えない
 */

function seed(page, extra = {}) {
  return page.addInitScript(({ extra }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const t = (id, title, o = {}) => ({
      id, title, description: 'メモ', priority: 'medium', status: 'todo', deadline: '2026-10-05', categoryId: 'c1',
      createdAt: '2026-09-01T00:00:00.000Z', order: 0, tags: ['タグ'],
      subtasks: [{ id: 's1', title: 'st', done: true }, { id: 's2', title: 'st2', done: false }],
      recurrence: { type: 'daily' }, ...o,
    });
    localStorage.setItem('dtask_tasks', JSON.stringify([
      t('a', 'A', { priority: 'high', deadline: '2020-01-01' }),
      t('b', 'B', { priority: 'low', status: 'inprogress', categoryId: 'c2' }),
      t('c', 'C', { status: 'done', categoryId: 'c3' }),
    ]));
    // 総点検で AA 未達だった色（緑・青）と、薄い黄色
    localStorage.setItem('dtask_categories', JSON.stringify([
      { id: 'c1', name: '仕事', color: '#2563EB' },
      { id: 'c2', name: 'プライベート', color: '#16A34A' },
      { id: 'c3', name: '趣味', color: '#FACC15' },
    ]));
    localStorage.setItem('dtask_hint_actions', '1');
    Object.entries(extra).forEach(([k, v]) => localStorage.setItem(k, v));
  }, { extra });
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

/* 表示中の文字要素ごとに、祖先の背景を合成した実効背景とのコントラスト比を測る */
async function contrastFailures(page) {
  // 色のトランジション途中を測らない
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  return page.evaluate(() => {
    const parse = (s) => {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(',').map(Number);
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const blend = (top, bot) => ({
      r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a),
      b: top.b * top.a + bot.b * (1 - top.a), a: 1,
    });
    const bgOf = (el) => {
      const stack = [];
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
      }
      let acc = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) acc = blend(stack[i], acc);
      return acc;
    };
    const visible = (e) => {
      for (let x = e; x; x = x.parentElement) if (+getComputedStyle(x).opacity === 0) return false;
      return e.offsetParent && e.getBoundingClientRect().width > 1;
    };
    const out = [];
    for (const e of document.querySelectorAll('body *')) {
      if (!visible(e) || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(e);
      const bg = bgOf(e);
      const fg = blend(parse(cs.color), bg);
      const L1 = lum(fg), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (+cs.fontWeight >= 700 && size >= 18.66);
      if (ratio < (large ? 3 : 4.5)) out.push(`${ratio.toFixed(2)} ${e.className} "${e.textContent.trim().slice(0, 15)}"`);
    }
    return [...new Set(out)];
  });
}

test.describe('アクセシビリティ (#354)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  for (const theme of ['light', 'dark']) {
    for (const view of ['list', 'kanban']) {
      test(`文字のコントラストが AA を満たす（${theme} / ${view}）`, async ({ page }) => {
        await seed(page, { dtask_theme: theme, dtask_view: view });
        await open(page);
        expect(await contrastFailures(page)).toEqual([]);
      });
    }
  }

  test('モバイルのタップ領域が 32px 以上', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, { dtask_view: 'kanban' });
    await open(page);
    await page.click('#hamburgerBtn');
    const small = await page.evaluate(() =>
      ['#addCategoryBtn', '.btn-delete-cat', '.subtask-toggle', '.kanban-status-select', '.fontsize-btn']
        .flatMap((sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent).map((e) => {
          const r = e.getBoundingClientRect();
          return { sel, w: Math.round(r.width), h: Math.round(r.height) };
        }))
        .filter((x) => x.w < 32 || x.h < 32));
    expect(small).toEqual([]);
  });

  test('プロジェクト追加ボタンに読み上げ名、期限プリセットはトグルボタン', async ({ page }) => {
    await seed(page);
    await open(page);
    await expect(page.getByRole('button', { name: 'プロジェクトを追加' })).toBeVisible();
    await expect(page.locator('[role="tab"]')).toHaveCount(0);
    await page.locator('.preset-chip[data-preset="week"]').click();
    await expect(page.locator('.preset-chip[data-preset="week"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.preset-chip[data-preset=""]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('モーダルを閉じると開いたボタンへフォーカスが戻る（⋮メニュー経由の編集・保存後も）', async ({ page }) => {
    await seed(page);
    await open(page);
    await page.locator('#shortcutsHelpBtn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#shortcutsModal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#shortcutsHelpBtn')).toBeFocused();

    const menuBtn = page.locator('.task-card[data-id="a"] .card-menu-btn');
    await menuBtn.focus();
    await page.keyboard.press('Enter');
    await page.locator('.card-menu-item', { hasText: '編集' }).click();
    await expect(page.locator('#taskModal')).toBeVisible();
    await page.locator('#taskForm button[type="submit"]').click(); // 保存で再描画され ⋮ は差し替わる
    await expect(page.locator('.task-card[data-id="a"] .card-menu-btn')).toBeFocused();
  });
});

/* 同期表示は Firebase SDK を偽モジュールに差し替えて状態を作る（#349 と同じ手法） */
const FAKE_APP = 'export function initializeApp() { return {}; }';
const fakeFirestore = (setDocMode) => `
const fs = (window.__fakeFs = { listeners: [] });
export function getFirestore() { return {}; }
export function doc() { return {}; }
export function getDoc() { return Promise.resolve({ exists: () => true, data: () => ({ tasks: [], categories: [] }) }); }
export function getDocFromServer() { return getDoc(); }
export function setDoc() { return ${setDocMode === 'hang' ? 'new Promise(() => {})' : "Promise.reject(new Error('permission-denied (fake)'))"}; }
export function onSnapshot(_r, a, b) { fs.listeners.push(typeof a === 'function' ? a : b); return () => {}; }
`;

test.describe('同期表示 (#354)', () => {
  async function openWithFake(page, mode) {
    await page.route('**/firebasejs/*/firebase-app.js', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_APP }));
    await page.route('**/firebasejs/*/firebase-firestore.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fakeFirestore(mode) }));
    await page.addInitScript(() => localStorage.setItem('dtask_hint_actions', '1'));
    await page.goto('/');
    await expect(page.locator('#quickAddInput')).toBeVisible({ timeout: 10000 });
    await page.waitForFunction(() => window.__fakeFs && window.__fakeFs.listeners.length > 0);
  }

  test('送信が終わらないと「同期中」のままにせず「送信待ち」を表示する', async ({ page }) => {
    await page.clock.install();
    await openWithFake(page, 'hang');
    await page.fill('#quickAddInput', 'E2E_送信待ち');
    await page.press('#quickAddInput', 'Enter');
    await expect(page.locator('#syncIndicator')).toHaveClass(/sync-syncing/);
    await page.clock.runFor(11_000);
    await expect(page.locator('#syncIndicator')).toHaveClass(/sync-pending/);
    await expect(page.locator('#syncIndicator')).toContainText('送信待ち');
  });

  test('保存失敗の表示（再試行）はオフライン→復帰で消えない', async ({ page, context }) => {
    await openWithFake(page, 'reject');
    await page.fill('#quickAddInput', 'E2E_保存失敗');
    await page.press('#quickAddInput', 'Enter');
    await expect(page.locator('#syncIndicator')).toHaveClass(/sync-error/);
    await context.setOffline(true);
    await context.setOffline(false);
    await page.waitForTimeout(300);
    await expect(page.locator('#syncIndicator')).toHaveClass(/sync-error/);
    await expect(page.getByRole('button', { name: '再試行' })).toBeVisible();
  });
});
