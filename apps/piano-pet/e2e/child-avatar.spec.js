import { test, expect } from '@playwright/test';

// こどものアバター（ヘッダ隅・#121）
test.describe('こどものアバター', () => {
  test.beforeEach(async ({ page }) => {
    // Firebase をブロックしてローカルのみで動作させる（本番Firestoreと干渉しない）
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    });
  });

  test('ヘッダ隅にアバターが常設表示され、未設定時は既定の絵文字（🐥）', async ({ page }) => {
    await page.goto('/');
    const avatar = page.locator('#view-home .child-avatar');
    await expect(avatar).toBeVisible({ timeout: 10000 });
    await expect(avatar.locator('.child-avatar__face')).toHaveText('🐥');
    // 名前は未設定なので空（CSS で非表示）
    await expect(avatar.locator('.child-avatar__name')).toHaveText('');
  });

  test('アイコンと名前を変更でき、リロード後も保持される', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#view-home .child-avatar')).toBeVisible({ timeout: 10000 });

    // アバターをタップして選択オーバーレイを開く
    await page.click('#view-home .child-avatar');
    await expect(page.locator('#avatarOverlay')).toBeVisible();

    // 名前を入力するとヘッダに即反映される
    await page.fill('#childNameInput', 'みき');
    await expect(page.locator('#view-home .child-avatar__name')).toHaveText('みき');

    // うさぎ（rabbit）を選ぶとヘッダの絵文字が変わる
    await page.click('.avatar-grid__btn[data-avatar="rabbit"]');
    await expect(page.locator('.avatar-grid__btn[data-avatar="rabbit"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#view-home .child-avatar__face')).toHaveText('🐰');

    // 「できた」で閉じる
    await page.click('button[data-action="close-avatar"]');
    await expect(page.locator('#avatarOverlay')).toBeHidden();

    // リロードしても保持されている（localStorage 永続）
    await page.reload();
    await expect(page.locator('#view-home .child-avatar__face')).toHaveText('🐰');
    await expect(page.locator('#view-home .child-avatar__name')).toHaveText('みき');

    // きろく画面のヘッダにも同じアバターが出る
    await page.click('.nav-btn[data-nav="history"]');
    await expect(page.locator('#view-history .child-avatar__face')).toHaveText('🐰');
    await expect(page.locator('#view-history .child-avatar__name')).toHaveText('みき');
  });

  test('名前だけ変更しても（アイコン未変更でも）保存される', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#view-home .child-avatar')).toBeVisible({ timeout: 10000 });

    await page.click('#view-home .child-avatar');
    await expect(page.locator('#avatarOverlay')).toBeVisible();
    // アイコンは触らず、名前だけ入力して閉じる
    await page.fill('#childNameInput', 'りく');
    await page.click('button[data-action="close-avatar"]');
    await expect(page.locator('#avatarOverlay')).toBeHidden();

    // リロードしても名前が残る（既定アイコンのまま）
    await page.reload();
    await expect(page.locator('#view-home .child-avatar__name')).toHaveText('りく');
    await expect(page.locator('#view-home .child-avatar__face')).toHaveText('🐥');
  });
});
