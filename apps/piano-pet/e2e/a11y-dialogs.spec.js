import { test, expect } from '@playwright/test';

// モーダルの操作・押せる大きさ・コントラスト（#397）。
async function boot(page, { onboarded = true, sessions = [] } = {}) {
  await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
  await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
  await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
  await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  await page.addInitScript(([ob, ss]) => {
    if (ob) { try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ } }
    localStorage.setItem('piano-pet', JSON.stringify({
      pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 200, equippedItems: [] },
      inventory: [], streak: { current: 0, best: 0, lastPracticeDate: null }, badges: [], sessions: ss,
    }));
  }, [onboarded, sessions]);
}

const activeId = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
const focusInside = (page, sel) => page.evaluate((s) => document.querySelector(s).contains(document.activeElement), sel);

async function passGate(page) {
  await expect(page.locator('#settingsGate')).toBeVisible();
  const a = Number(await page.locator('#gateA').textContent());
  const b = Number(await page.locator('#gateB').textContent());
  await page.fill('#gateAnswer', String(a * b));
  await page.click('#gateSubmit');
  await expect(page.locator('#settingsMenu')).toBeVisible();
}

test.describe('モーダルの操作（#397）', () => {
  test('せってい: Tab は中で回り、ゲートを通るとメニューへフォーカス、Esc で閉じて ⚙️ へ戻る', async ({ page }) => {
    await boot(page);
    await page.goto('/');
    await expect(page.locator('#settingsToggle')).toBeVisible({ timeout: 10000 });
    await page.focus('#settingsToggle');
    await page.keyboard.press('Enter');
    await expect(page.locator('#settingsGate')).toBeVisible();
    expect(await activeId(page)).toBe('gateAnswer');
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusInside(page, '#settingsOverlay')).toBe(true);
    }
    await passGate(page);
    expect(await focusInside(page, '#settingsMenu')).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settingsOverlay')).toBeHidden();
    expect(await activeId(page)).toBe('settingsToggle');
  });

  test('じぶんの アイコン: 開くと中へフォーカス、Esc で閉じてアイコンへ戻る。選択肢に読み上げ名がある', async ({ page }) => {
    await boot(page);
    await page.goto('/');
    const opener = page.locator('#view-home [data-action="open-avatar"]');
    await expect(opener).toBeVisible({ timeout: 10000 });
    await opener.click();
    await expect(page.locator('#avatarOverlay')).toBeVisible();
    expect(await focusInside(page, '#avatarOverlay')).toBe(true);
    await expect(page.locator('.avatar-grid__btn[data-avatar="rabbit"]')).toHaveAttribute('aria-label', 'うさぎ');
    await page.keyboard.press('Escape');
    await expect(page.locator('#avatarOverlay')).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.dataset.action)).toBe('open-avatar');
  });

  // 枠に収まり、かつ横に並ぶ（1列に縮んで縦に並ばない）。375px は5列・320px は4列
  for (const [width, cols] of [[375, 5], [320, 4]]) {
    test(`${width}px で じぶんの アイコンの選択肢（44px）が枠からはみ出さず ${cols}列に並ぶ`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 });
      await boot(page);
      await page.goto('/');
      const opener = page.locator('#view-home [data-action="open-avatar"]');
      await expect(opener).toBeVisible({ timeout: 10000 });
      await opener.click();
      await expect(page.locator('#avatarOverlay')).toBeVisible();
      const panel = await page.locator('#avatarOverlay .settings-panel').evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(panel).toBeLessThanOrEqual(0);
      const tops = await page.locator('.avatar-grid__btn').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
      expect(tops.filter((t) => t === tops[0])).toHaveLength(cols);
    });
  }

  test('名前の入力で日本語変換中の Esc では、じぶんの アイコンが閉じない', async ({ page }) => {
    await boot(page);
    await page.goto('/');
    const opener = page.locator('#view-home [data-action="open-avatar"]');
    await expect(opener).toBeVisible({ timeout: 10000 });
    await opener.click();
    await page.focus('#childNameInput');
    await page.evaluate(() => {
      document.getElementById('childNameInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
    });
    await expect(page.locator('#avatarOverlay')).toBeVisible();
  });

  test('オンボーディング: 開くと「つぎへ」にフォーカス、Esc でスキップ扱い', async ({ page }) => {
    await boot(page, { onboarded: false });
    await page.goto('/');
    await expect(page.locator('#onboardingOverlay')).toBeVisible({ timeout: 10000 });
    expect(await activeId(page)).toBe('onboardingNext');
    await page.keyboard.press('Escape');
    await expect(page.locator('#onboardingOverlay')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('piano-pet-onboarded'))).toBe('1');
  });

  test('ブラウザの戻る（画面の切り替わり）で、開いていたせっていが閉じる', async ({ page }) => {
    await boot(page);
    await page.goto('/');
    await expect(page.locator('#settingsToggle')).toBeVisible({ timeout: 10000 });
    await page.click('#settingsToggle');
    await expect(page.locator('#settingsOverlay')).toBeVisible();
    await page.evaluate(() => { location.hash = '#/badges'; });
    await expect(page.locator('#settingsOverlay')).toBeHidden();
  });

  test('きろくの ほうほうは aria-pressed のトグル（タブを名乗らない）', async ({ page }) => {
    await boot(page);
    await page.goto('/#/record');
    await expect(page.locator('#modeStampBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#modeStampBtn')).not.toHaveAttribute('role', 'tab');
    await expect(page.locator('#modeStampBtn')).toHaveAttribute('aria-pressed', 'true');
    await page.click('#modeBatchBtn');
    await expect(page.locator('#modeBatchBtn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#modeStampBtn')).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('押せる大きさとコントラスト（#397）', () => {
  const day = (back) => {
    const d = new Date(); d.setDate(d.getDate() - back);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  async function expectAtLeast44(page, selectors) {
    for (const sel of selectors) {
      const box = await page.locator(sel).first().boundingBox();
      expect(box, sel).not.toBeNull();
      expect(Math.round(box.height), `${sel} の高さ`).toBeGreaterThanOrEqual(44);
    }
  }

  test('主要なボタンの高さが 44px 以上', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await boot(page, { sessions: [{ date: day(0), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 }] });
    await page.goto('/');
    await expect(page.locator('#settingsToggle')).toBeVisible({ timeout: 10000 });
    await expectAtLeast44(page, ['#soundToggle', '#settingsToggle', '#view-home .child-avatar', '#dressupToggle', '#photoBtn']);
    const settingsBox = await page.locator('#settingsToggle').boundingBox();
    expect(Math.round(settingsBox.width)).toBeGreaterThanOrEqual(44);

    await page.goto('/#/history');
    await expect(page.locator('#calPrevBtn')).toBeVisible({ timeout: 10000 });
    await expectAtLeast44(page, ['#calPrevBtn', '.history-action', '.praise-stamp', '.tempo-stamp']);

    await page.goto('/#/shop');
    await expect(page.locator('.shop-cat').first()).toBeVisible({ timeout: 10000 });
    await expectAtLeast44(page, ['.shop-cat', '#shopList .shop-btn']);
  });

  test('せっていの説明文と「いま これ」の文字が AA（4.5:1）の色になっている', async ({ page }) => {
    await boot(page);
    await page.goto('/');
    await expect(page.locator('#settingsToggle')).toBeVisible({ timeout: 10000 });
    await page.click('#settingsToggle');
    await passGate(page);
    const colors = await page.evaluate(() => ({
      desc: getComputedStyle(document.querySelector('.settings-menu__desc')).color,
      badge: getComputedStyle(document.querySelector('.account-row__badge')).color,
    }));
    expect(colors.desc).toBe('rgb(107, 91, 94)');    // --text-muted
    expect(colors.badge).toBe('rgb(184, 50, 79)');   // --pink-ink
  });
});
