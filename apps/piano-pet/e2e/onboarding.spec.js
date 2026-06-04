import { test, expect } from '@playwright/test';

// 初回オンボーディング（猫の吹き出し紙芝居・#141）
test.describe('初回オンボーディング', () => {
  test.beforeEach(async ({ page }) => {
    // 本番Firestoreへの読み書きと干渉を防ぐためFirebase関連を全てブロック。
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('初回起動で紙芝居が出て、つぎへで3画面進んで はじめる で閉じる', async ({ page }) => {
    await page.goto('/');

    const overlay = page.locator('#onboardingOverlay');
    await expect(overlay).toBeVisible({ timeout: 10000 });

    // 1画面目
    await expect(page.locator('#onboardingTitle')).toHaveText('れんしゅうを きろく');
    await expect(page.locator('#onboardingNext')).toHaveText('つぎへ');
    await expect(page.locator('.onboarding__dot')).toHaveCount(3);

    // 2画面目
    await page.click('#onboardingNext');
    await expect(page.locator('#onboardingTitle')).toHaveText('ごほうびが もらえる');

    // 3画面目：最後はボタンが「はじめる！」になる
    await page.click('#onboardingNext');
    await expect(page.locator('#onboardingTitle')).toHaveText('きせかえ・ごはん');
    await expect(page.locator('#onboardingNext')).toHaveText('はじめる！');

    // はじめる → 閉じてホームが操作できる
    await page.click('#onboardingNext');
    await expect(overlay).toBeHidden();
    await expect(page.locator('#goRecordBtn')).toBeVisible();
  });

  test('スキップで即閉じる', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#onboardingOverlay')).toBeVisible({ timeout: 10000 });
    await page.click('#onboardingSkip');
    await expect(page.locator('#onboardingOverlay')).toBeHidden();
  });

  test('一度見たらリロードしても出ない', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#onboardingOverlay')).toBeVisible({ timeout: 10000 });
    await page.click('#onboardingSkip');
    await expect(page.locator('#onboardingOverlay')).toBeHidden();

    await page.reload();
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#onboardingOverlay')).toBeHidden();
  });
});
