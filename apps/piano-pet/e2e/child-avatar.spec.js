import { test, expect, gotoHome } from './helpers.js';

// こどものアバター（ヘッダ隅・#121）
test.describe('こどものアバター', () => {
  test('既定は🐥・名前なし。アイコンと名前を変えるとヘッダに出て、リロード後も残る', async ({ page }) => {
    await gotoHome(page);
    const face = page.locator('#view-home .child-avatar__face');
    const name = page.locator('#view-home .child-avatar__name');
    await expect(face).toHaveText('🐥');
    await expect(name).toHaveText('');

    await page.click('#view-home .child-avatar');
    await expect(page.locator('#avatarOverlay')).toBeVisible();
    await page.fill('#childNameInput', 'みき');
    await expect(name).toHaveText('みき');   // 入力中から反映
    await page.click('.avatar-grid__btn[data-avatar="rabbit"]');
    await expect(page.locator('.avatar-grid__btn[data-avatar="rabbit"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(face).toHaveText('🐰');
    await page.click('button[data-action="close-avatar"]');
    await expect(page.locator('#avatarOverlay')).toBeHidden();

    await page.reload();
    await expect(face).toHaveText('🐰');
    await expect(name).toHaveText('みき');
    await page.click('.nav-btn[data-nav="history"]');   // ほかの画面のヘッダにも出る
    await expect(page.locator('#view-history .child-avatar__face')).toHaveText('🐰');
    await expect(page.locator('#view-history .child-avatar__name')).toHaveText('みき');
  });

  test('名前だけ変えても（アイコンは既定のまま）保存される', async ({ page }) => {
    await gotoHome(page);
    await page.click('#view-home .child-avatar');
    await page.fill('#childNameInput', 'りく');
    await page.click('button[data-action="close-avatar"]');
    await expect(page.locator('#avatarOverlay')).toBeHidden();

    await page.reload();
    await expect(page.locator('#view-home .child-avatar__name')).toHaveText('りく');
    await expect(page.locator('#view-home .child-avatar__face')).toHaveText('🐥');
  });
});
