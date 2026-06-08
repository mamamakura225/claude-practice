import { test, expect } from '@playwright/test';

/**
 * スワイプ削除 E2E (#25)
 * - Chromium のモバイルエミュレーション (hasTouch + isMobile) で touch を有効化
 * - CDP の Input.dispatchTouchEvent でタッチイベントを送る
 * - 左スワイプ > 100px (SWIPE_AUTO_TRIGGER) で削除トリガー
 * - 削除アニメーション 350ms 後に wrapper.remove() & 再描画 → トースト「削除しました」
 */

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148',
});

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

/**
 * page.evaluate でカードに対し TouchEvent を直接ディスパッチして左スワイプを再現。
 * Chromium は標準で TouchEvent / Touch コンストラクタをサポートする。
 */
async function swipeLeft(page, selector, distance = 200, steps = 12) {
  return page.evaluate(
    ({ selector, distance, steps }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`element not found: ${selector}`);
      const rect = el.getBoundingClientRect();
      const startX = rect.right - 20;
      const startY = rect.top + rect.height / 2;

      const mkTouch = (x, y) =>
        new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      const fire = (type, x, y) => {
        const list = type === 'touchend' ? [] : [mkTouch(x, y)];
        const ev = new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: list,
          targetTouches: list,
          changedTouches: [mkTouch(x, y)],
        });
        el.dispatchEvent(ev);
      };

      fire('touchstart', startX, startY);
      for (let i = 1; i <= steps; i++) {
        const x = startX - (distance * i) / steps;
        fire('touchmove', x, startY);
      }
      fire('touchend', startX - distance, startY);
    },
    { selector, distance, steps }
  );
}

test.describe('スワイプ削除（モバイル）', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('左スワイプでタスクが削除されトーストが表示される', async ({ page }) => {
    await seedTasks(page, [
      {
        id: 't-swipe',
        title: 'E2E_スワイプ_削除対象',
        priority: 'medium',
        status: 'todo',
        deadline: '',
        createdAt: '2026-05-19T09:00:00.000Z',
        order: 0,
        tags: [],
        subtasks: [],
        recurrence: null,
        categoryId: '',
      },
    ]);
    await page.goto('/');
    // モバイル幅では #addTaskBtn が非表示。「すべて」切替が init 完了待ちを兼ねる
    await showAll(page);
    const card = page.locator('#taskList .task-card[data-id="t-swipe"]');
    await expect(card).toBeVisible({ timeout: 10000 });

    // 左スワイプ 200px（SWIPE_AUTO_TRIGGER=100 を超える）
    await swipeLeft(page, '#taskList .task-card[data-id="t-swipe"]', 200);

    // アニメーション後にカードが消える
    await expect(card).toHaveCount(0, { timeout: 3000 });

    // 削除トースト
    await expect(
      page.locator('#toastContainer .toast', { hasText: '削除しました' })
    ).toBeVisible();
  });
});
