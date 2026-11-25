import { test, expect, fixRandom, gotoHome, openSettings, record } from './helpers.js';

// 親ゲートの内側の設定（アカウント切替 #182 / がめんの あかるさ #151）。
test.describe('せってい（親ゲートの内側）', () => {
  test('アカウントを切り替えると保存先が分かれ、記録が混ざらない（#182）', async ({ page }) => {
    await fixRandom(page, 0.999);
    await gotoHome(page);
    await record(page, 3);   // 娘（既定）
    await expect(page.locator('#statCoins')).toHaveText('3');

    const active = page.locator('#accountList .account-row--active .account-row__name');
    await page.reload();
    await openSettings(page);
    await expect(active).toHaveText('娘');
    await page.click('#accountList .account-switch');   // リロードを伴う
    await expect(page.locator('#statCoins')).toHaveText('0', { timeout: 10000 });   // 新品のアカウント
    const saved = await page.evaluate(() => ({
      daughter: JSON.parse(localStorage.getItem('piano-pet')),
      active: JSON.parse(localStorage.getItem('piano-pet:accounts')).active,
    }));
    expect(saved.active).toBe('test');
    expect(saved.daughter.pet.coins).toBe(3);

    await openSettings(page);
    await expect(active).toHaveText('テスト用');
    await page.click('#accountList .account-switch');
    await expect(page.locator('#statCoins')).toHaveText('3', { timeout: 10000 });
  });

  test('がめんの あかるさ: data-theme と保存値が変わり、選択中のボタンが見た目で分かる（#151/#396）', async ({ page }) => {
    await gotoHome(page);
    // 記録画面を一度開く（記録モードの表示同期が、テーマ側の選択表示を消していた・#396）
    await page.click('#goRecordBtn');
    await page.click('#recordBackBtn');
    await openSettings(page);

    const btn = (choice) => page.locator(`#themeSwitch [data-theme-choice="${choice}"]`);
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme ?? null);
    await expect(btn('auto')).toHaveClass(/is-active/);
    expect(await theme()).toBeNull();   // じどう＝属性を付けない
    for (const choice of ['dark', 'light', 'auto']) {
      await btn(choice).click();
      await expect(btn(choice)).toHaveClass(/is-active/);
      await expect(page.locator('#themeSwitch .is-active')).toHaveCount(1);
      expect(await theme()).toBe(choice === 'auto' ? null : choice);
      expect(await page.evaluate(() => localStorage.getItem('pp-theme'))).toBe(choice);
    }
  });
});
