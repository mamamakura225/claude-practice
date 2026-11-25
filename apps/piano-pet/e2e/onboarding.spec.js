import { test, expect, gotoHome } from './helpers.js';

// 初回オンボーディング（猫の吹き出し紙芝居・#141）
test.use({ onboarded: false });

test.describe('初回オンボーディング', () => {
  test('「つぎへ」で3画面進み、「はじめる！」で閉じる', async ({ page }) => {
    await page.goto('/');
    const title = page.locator('#onboardingTitle');
    const next = page.locator('#onboardingNext');
    await expect(title).toHaveText('れんしゅうを きろく', { timeout: 10000 });
    await expect(next).toHaveText('つぎへ');
    await expect(page.locator('.onboarding__dot')).toHaveCount(3);
    await next.click();
    await expect(title).toHaveText('ごほうびが もらえる');
    await next.click();
    await expect(title).toHaveText('きせかえ・ごはん');
    await expect(next).toHaveText('はじめる！');
    await next.click();
    await expect(page.locator('#onboardingOverlay')).toBeHidden();
    await expect(page.locator('#goRecordBtn')).toBeVisible();
  });

  test('スキップで閉じ、一度見たら開き直しても出ない', async ({ page }) => {
    await page.goto('/');
    await page.click('#onboardingSkip');
    await expect(page.locator('#onboardingOverlay')).toBeHidden();

    await page.reload();
    await gotoHome(page);
    await expect(page.locator('#onboardingOverlay')).toBeHidden();
  });

  test('開くと「つぎへ」にフォーカスし、Esc でスキップ扱いになる（#397）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#onboardingNext')).toBeFocused({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('#onboardingOverlay')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('piano-pet-onboarded'))).toBe('1');
  });

  test('横向き（667x375）でも「つぎへ」まで届く（#396）', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await page.goto('/');
    const next = page.locator('#onboardingNext');
    await expect(next).toBeVisible({ timeout: 10000 });
    const card = await page.locator('.onboarding__card').boundingBox();
    expect(card.y).toBeGreaterThanOrEqual(0);   // 上が切れない
    // media query が後ろの基本ルールに負けていない（ねこが縮んでいる）
    expect(await page.locator('.onboarding__cat').evaluate((el) => getComputedStyle(el).width)).toBe('72px');
    await next.scrollIntoViewIfNeeded();
    const btn = await next.boundingBox();
    expect(btn.y + btn.height).toBeLessThanOrEqual(375);
    await next.click();
    await expect(page.locator('#onboardingTitle')).toHaveText('ごほうびが もらえる');
  });
});
