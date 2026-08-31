import { test, expect } from '@playwright/test';

// 親ゲートの内側の設定（アカウント切替 #182 / がめんの あかるさ #151）。
// どちらも「保存先やDOM属性の切り替え」だけの機能だが、壊れると気づきにくいのでE2Eで固定する。
test.describe('せってい（親ゲートの内側）', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
      Math.random = () => 0.999;
    });
  });

  // 親ゲート（1桁×1桁の掛け算）を解いてメニューを開く。
  async function openSettings(page) {
    await page.click('#settingsToggle');
    await expect(page.locator('#settingsGate')).toBeVisible();
    const a = Number(await page.locator('#gateA').textContent());
    const b = Number(await page.locator('#gateB').textContent());
    await page.fill('#gateAnswer', String(a * b));
    await page.click('#gateSubmit');
    await expect(page.locator('#settingsMenu')).toBeVisible();
  }

  test('アカウントを切り替えると保存先が分かれ、記録が混ざらない（#182）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    // 娘（既定）で 3かい 記録する
    await page.click('#goRecordBtn');
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    for (let i = 0; i < 3; i += 1) await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#statCoins')).toHaveText('3');

    // テスト用へ切り替え（リロードを伴う）
    await openSettings(page);
    await expect(page.locator('#accountList .account-row--active .account-row__name')).toHaveText('娘');
    await page.click('#accountList .account-switch');
    await expect(page.locator('#statCoins')).toHaveText('0', { timeout: 10000 });   // 新品のアカウント

    // 保存先キーが分かれている
    const keys = await page.evaluate(() => ({
      musume: localStorage.getItem('piano-pet'),
      test: localStorage.getItem('piano-pet:test'),
      active: JSON.parse(localStorage.getItem('piano-pet:accounts')).active,
    }));
    expect(keys.active).toBe('test');
    expect(JSON.parse(keys.musume).pet.coins).toBe(3);   // 娘のデータは残っている

    // 娘へ戻すと記録が戻る
    await openSettings(page);
    await expect(page.locator('#accountList .account-row--active .account-row__name')).toHaveText('テスト用');
    await page.click('#accountList .account-switch');
    await expect(page.locator('#statCoins')).toHaveText('3', { timeout: 10000 });
  });

  test('がめんの あかるさを切り替えると data-theme と保存値が変わる（#151）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await openSettings(page);

    // 既定は「じどう」＝属性を付けない
    expect(await page.evaluate(() => document.documentElement.dataset.theme ?? null)).toBeNull();

    await page.click('#themeSwitch [data-theme-choice="dark"]');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    expect(await page.evaluate(() => localStorage.getItem('pp-theme'))).toBe('dark');

    await page.click('#themeSwitch [data-theme-choice="light"]');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');

    await page.click('#themeSwitch [data-theme-choice="auto"]');
    expect(await page.evaluate(() => document.documentElement.dataset.theme ?? null)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('pp-theme'))).toBe('auto');
  });

  test('親ゲートは誤答で開かない', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await page.click('#settingsToggle');
    await expect(page.locator('#settingsGate')).toBeVisible();   // 出題は遅延読込のあとに入る（#284）
    const a = Number(await page.locator('#gateA').textContent());
    const b = Number(await page.locator('#gateB').textContent());
    await page.fill('#gateAnswer', String(a * b + 1));
    await page.click('#gateSubmit');
    await expect(page.locator('#gateError')).toBeVisible();
    await expect(page.locator('#settingsMenu')).toBeHidden();
  });
});

