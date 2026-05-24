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
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    const catSvg = page.locator('#catStage svg');
    await expect(catSvg).toBeVisible();

    // タップ直後は反応クラス（喜ぶ or しっぽふり）が付く。終了時に剥がれる前に確認する。
    await page.click('#catStage');
    await expect(catSvg).toHaveClass(/cat--(happy|wiggle)/);
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
