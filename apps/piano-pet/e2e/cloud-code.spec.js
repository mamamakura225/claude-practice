import { test, expect } from '@playwright/test';

// クラウド保存先の推測不能化（がぞくコード・#233 段階1）。
// 実際の移行はクラウド書き込みを伴うため E2E ではブロック（本番データを触らない）。
// ここでは「未移行の既定表示」「他端末からのコード合流」「不正コードの拒否」を検証する。
test.describe('がぞくコード（#233）', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    });
  });

  async function passGate(page) {
    await page.click('#settingsToggle');
    await expect(page.locator('#settingsGate')).toBeVisible();
    const a = Number(await page.locator('#gateA').textContent());
    const b = Number(await page.locator('#gateB').textContent());
    await page.fill('#gateAnswer', String(a * b));
    await page.click('#gateSubmit');
    await expect(page.locator('#settingsMenu')).toBeVisible();
  }

  test('未移行なら「うつす」ボタンが出て、コード表示は隠れている', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await passGate(page);

    await expect(page.locator('#cloudNotMigrated')).toBeVisible();
    await expect(page.locator('#cloudMigrateBtn')).toBeVisible();
    await expect(page.locator('#cloudMigrated')).toBeHidden();
  });

  test('他端末のコードに合流でき、次回以降そのコードが表示される', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await passGate(page);

    const code = 'pp-0123456789abcdef0123456789abcdef';
    await page.fill('#cloudCodeInput', code);
    // リロードを待たずに次の操作へ進むと、破棄される直前のページを触ってしまう。
    // 設定の開閉が非同期になった（#284 の遅延読込）ことで表面化したので、load を待つ。
    const reloaded = page.waitForEvent('load');
    await page.click('#cloudJoinBtn');   // 保存してリロードする
    await reloaded;

    // リロード後、親ゲートを通ると「移行済み」表示＋そのコードが出る
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await passGate(page);
    await expect(page.locator('#cloudMigrated')).toBeVisible();
    await expect(page.locator('#cloudCodeValue')).toHaveText(code);
    await expect(page.locator('#cloudNotMigrated')).toBeHidden();

    // 保存先も切り替わっている（端末ローカルのみ・クラウドには載せない）
    const saved = await page.evaluate(() => localStorage.getItem('piano-pet:cloud-ids'));
    expect(JSON.parse(saved).data).toBe(code);
  });

  test('不正な形式のコードは拒否してエラーを出す', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await passGate(page);

    await page.fill('#cloudCodeInput', 'bad code');
    await page.click('#cloudJoinBtn');

    await expect(page.locator('#cloudStatus')).toBeVisible();
    await expect(page.locator('#cloudStatus')).toContainText('かたち');
    // 保存されていない＝未移行のまま
    const saved = await page.evaluate(() => localStorage.getItem('piano-pet:cloud-ids'));
    expect(saved).toBeNull();
  });
});
