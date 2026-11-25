import { test, expect, session, makeState, seed, gotoHome, openSettings, solveGate } from './helpers.js';

// モーダルの操作・押せる大きさ・コントラスト（#397）。オンボーディングの操作は onboarding.spec.js。
const focusInside = (page, sel) => page.evaluate((s) => document.querySelector(s).contains(document.activeElement), sel);
const openAvatar = async (page) => {
  await page.click('#view-home [data-action="open-avatar"]');
  await expect(page.locator('#avatarOverlay')).toBeVisible();
};

test.describe('モーダルの操作（#397）', () => {
  test('せってい: Tab は中で回り、ゲートを通るとメニューへフォーカス、Esc で閉じて ⚙️ へ戻る', async ({ page }) => {
    await gotoHome(page);
    await page.focus('#settingsToggle');
    await page.keyboard.press('Enter');
    await expect(page.locator('#settingsGate')).toBeVisible();
    await expect(page.locator('#gateAnswer')).toBeFocused();
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusInside(page, '#settingsOverlay')).toBe(true);
    }
    await solveGate(page);
    expect(await focusInside(page, '#settingsMenu')).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settingsOverlay')).toBeHidden();
    await expect(page.locator('#settingsToggle')).toBeFocused();
  });

  test('じぶんの アイコン: 中へフォーカスし、Esc で閉じてアイコンへ戻る（変換中の Esc では閉じない）。選択肢に読み上げ名がある', async ({ page }) => {
    await gotoHome(page);
    await openAvatar(page);
    expect(await focusInside(page, '#avatarOverlay')).toBe(true);
    await expect(page.locator('.avatar-grid__btn[data-avatar="rabbit"]')).toHaveAttribute('aria-label', 'うさぎ');
    await page.locator('#childNameInput').evaluate((el) => {
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
    });
    await expect(page.locator('#avatarOverlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#avatarOverlay')).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.dataset.action)).toBe('open-avatar');
  });

  test('じぶんの アイコンの選択肢が枠からはみ出さず横に並ぶ（375px は5列・320px は4列）', async ({ page }) => {
    await gotoHome(page);
    await openAvatar(page);
    for (const [width, cols] of [[375, 5], [320, 4]]) {
      await page.setViewportSize({ width, height: 640 });
      const overflow = await page.locator('#avatarOverlay .settings-panel').evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, `${width}px のはみ出し`).toBeLessThanOrEqual(0);
      const tops = await page.locator('.avatar-grid__btn').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
      expect(tops.filter((t) => t === tops[0]), `${width}px の列数`).toHaveLength(cols);
    }
  });

  test('ブラウザの戻る（画面の切り替わり）で、開いていたせっていが閉じる', async ({ page }) => {
    await gotoHome(page);
    await page.click('#settingsToggle');
    await expect(page.locator('#settingsOverlay')).toBeVisible();
    await page.evaluate(() => { location.hash = '#/badges'; });
    await expect(page.locator('#settingsOverlay')).toBeHidden();
  });

  test('きろくの ほうほうは aria-pressed のトグル（タブを名乗らない）', async ({ page }) => {
    await page.goto('/#/record');
    const stamp = page.locator('#modeStampBtn');
    await expect(stamp).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
    await expect(stamp).not.toHaveAttribute('role', 'tab');
    await page.click('#modeBatchBtn');
    await expect(page.locator('#modeBatchBtn')).toHaveAttribute('aria-pressed', 'true');
    await expect(stamp).toHaveAttribute('aria-pressed', 'false');
  });

  test('もどるボタンの読み上げ・ナビの選択・あかるさの役割が、見えているものと合う（#428）', async ({ page }) => {
    await seed(page, makeState({ sessions: [session('2026-01-01', 1)] }));
    await page.goto('/#/record');
    await expect(page.locator('#recordBackBtn')).toHaveAttribute('aria-label', 'ホームにもどる');
    await expect(page.locator('.nav-btn.active')).toHaveAttribute('aria-current', 'page');
    await page.click('.nav-btn[data-nav="history"]');
    await page.locator('[data-action="edit-session"]').click();
    await expect(page.locator('#recordBackBtn')).toHaveAttribute('aria-label', 'きろくにもどる');
    await expect(page.locator('#themeSwitch')).toHaveAttribute('role', 'group');   // 中は aria-pressed のトグル（radio ではない）
  });
});

test.describe('押せる大きさとコントラスト（#397）', () => {
  async function expectAtLeast44(page, selectors) {
    for (const sel of selectors) {
      await expect(page.locator(sel).first()).toBeVisible({ timeout: 10000 });
      const box = await page.locator(sel).first().boundingBox();
      expect(Math.round(box.height), `${sel} の高さ`).toBeGreaterThanOrEqual(44);
    }
  }

  test('主要なボタンの高さが 44px 以上', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await seed(page, makeState({ pet: { coins: 200 }, sessions: [session(0)] }));
    await gotoHome(page);
    await expectAtLeast44(page, ['#soundToggle', '#settingsToggle', '#view-home .child-avatar', '#dressupToggle', '#photoBtn']);
    const settingsBox = await page.locator('#settingsToggle').boundingBox();
    expect(Math.round(settingsBox.width)).toBeGreaterThanOrEqual(44);
    await page.goto('/#/history');
    await expectAtLeast44(page, ['#calPrevBtn', '.history-action', '.praise-stamp', '.tempo-stamp']);
    await page.goto('/#/shop');
    await expectAtLeast44(page, ['.shop-cat', '#shopList .shop-btn']);
  });

  test('せっていの説明文と「いま これ」の文字が、地の色に対して AA（4.5:1）を満たす', async ({ page }) => {
    await gotoHome(page);
    await openSettings(page);
    for (const sel of ['.settings-menu__desc', '.account-row__badge']) {
      const ratio = await page.locator(sel).first().evaluate((el) => {
        const rgba = (s) => s.match(/[\d.]+/g).map(Number);
        const lum = (c) => c.slice(0, 3).map((v) => v / 255)
          .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        let bg = el;   // 不透明な背景を持つ祖先まで遡る
        while (bg && (rgba(getComputedStyle(bg).backgroundColor)[3] ?? 1) < 1) bg = bg.parentElement;
        const [hi, lo] = [lum(rgba(getComputedStyle(el).color)), lum(rgba(getComputedStyle(bg).backgroundColor))].sort((a, b) => b - a);
        return (hi + 0.05) / (lo + 0.05);
      });
      expect(ratio, sel).toBeGreaterThanOrEqual(4.5);
    }
  });
});
