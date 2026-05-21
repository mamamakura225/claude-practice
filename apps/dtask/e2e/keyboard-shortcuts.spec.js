import { test, expect } from '@playwright/test';

/**
 * キーボードショートカット E2E (#25)
 * - N: クイック追加バーにフォーカス
 * - /: 検索バーにフォーカス
 * - Esc: 開いているモーダルを閉じる / 入力からフォーカスを外す
 */

test.describe('キーボードショートカット', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('#addTaskBtn')).toBeVisible({ timeout: 10000 });
  });

  test('N キーでクイック追加バーにフォーカスする', async ({ page }) => {
    // 念のため body にフォーカスを置く
    await page.locator('body').click();
    await page.keyboard.press('n');
    await expect(page.locator('#quickAddInput')).toBeFocused();
  });

  test('/ キーで検索バーにフォーカスする', async ({ page }) => {
    await page.locator('body').click();
    await page.keyboard.press('/');
    await expect(page.locator('#searchInput')).toBeFocused();
  });

  test('Esc キーでタスクモーダルを閉じる', async ({ page }) => {
    // モーダルを開く（init待ち含む）
    await expect(async () => {
      await page.click('#addTaskBtn');
      await expect(page.locator('#taskModal')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });

    // Esc で閉じる
    await page.keyboard.press('Escape');
    await expect(page.locator('#taskModal')).toBeHidden();
  });

  test('入力フォーカス中は N / / が効かず、Esc で blur のみ実行される', async ({ page }) => {
    // 検索バーにフォーカスを置く
    const search = page.locator('#searchInput');
    await search.focus();
    await search.fill('検索文字');

    // この状態で N を押しても searchInput のまま（普通の文字入力として処理される）
    await page.keyboard.press('n');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('検索文字n');

    // Esc でフォーカス外れる
    await page.keyboard.press('Escape');
    await expect(search).not.toBeFocused();
  });
});
