import { test, expect } from '@playwright/test';

// ホームで猫をなでる/タップする interaction（#79）
test.describe('猫とのインタラクション', () => {
  test.beforeEach(async ({ page }) => {
    // 本番Firestoreへの読み書きと干渉を防ぐためFirebase関連を全てブロック。
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('猫をタップすると反応アニメーションが再生される', async ({ page }) => {
    // Math.random を固定して威嚇(hiss)を起こさせない（hiss だと演出を出さないため）。
    await page.addInitScript(() => { Math.random = () => 0.99; });
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    const catSvg = page.locator('#catStage svg');
    await expect(catSvg).toBeVisible();

    // タップ直後は反応クラス（喜ぶ or しっぽふり）が付く。終了時に剥がれる前に確認する。
    await page.click('#catStage');
    await expect(catSvg).toHaveClass(/cat--(happy|wiggle)/);
  });

  test('威嚇(hiss)したときは喜び演出（ハート・しっぽふり）を出さない', async ({ page }) => {
    // Math.random を 0 に固定して必ず hiss にする。
    await page.addInitScript(() => { Math.random = () => 0; });
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    const catSvg = page.locator('#catStage svg');
    await expect(catSvg).toBeVisible();

    await page.click('#catStage');
    // 反応クラスが付かないこと。誤って付くなら数百ms残るので、少し待ってから確認する。
    await page.waitForTimeout(300);
    await expect(catSvg).not.toHaveClass(/cat--(happy|wiggle)/);
  });

  test('なでなでボタンは記録ボタンとは別の安全操作（コインは増えない）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#statCoins')).toHaveText('0');

    // なでてもホームのまま、コインやストリークは変化しない（記録ではない）
    await page.click('#petBtn');
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#statCoins')).toHaveText('0');
    await expect(page.locator('#statStreak')).toHaveText('0');
  });
});
