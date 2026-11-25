import { test, expect, gotoHome, openSettings } from './helpers.js';

// クラウド保存先の推測不能化（がぞくコード・#233）。移行そのものはクラウド書き込みを伴うので通さない。
test.describe('がぞくコード（#233）', () => {
  const savedCode = (page) => page.evaluate(() => localStorage.getItem('piano-pet:cloud-ids'));

  test('未移行なら「うつす」だけが出る。形の違うコードはエラーを出して保存しない', async ({ page }) => {
    await gotoHome(page);
    await openSettings(page);
    await expect(page.locator('#cloudMigrateBtn')).toBeVisible();
    await expect(page.locator('#cloudMigrated')).toBeHidden();

    await page.fill('#cloudCodeInput', 'bad code');
    await page.click('#cloudJoinBtn');
    await expect(page.locator('#cloudStatus')).toContainText('かたち');
    expect(await savedCode(page)).toBeNull();
  });

  test('ほかの端末のコードに合流でき、次回以降そのコードが表示される', async ({ page }) => {
    await gotoHome(page);
    await openSettings(page);
    const code = 'pp-0123456789abcdef0123456789abcdef';
    await page.fill('#cloudCodeInput', code);
    // リロードを待たずに次へ進むと、破棄される直前のページを触ってしまう
    const reloaded = page.waitForEvent('load');
    await page.click('#cloudJoinBtn');
    await reloaded;

    await openSettings(page);
    await expect(page.locator('#cloudCodeValue')).toHaveText(code);
    await expect(page.locator('#cloudNotMigrated')).toBeHidden();
    expect(JSON.parse(await savedCode(page)).data).toBe(code);
  });
});
