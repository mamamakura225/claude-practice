import { test, expect } from '@playwright/test';

// ホームで猫をなでる/タップする interaction（#79）
test.describe('猫とのインタラクション', () => {
  test.beforeEach(async ({ page }) => {
    // 本番Firestoreへの読み書きと干渉を防ぐためFirebase関連を全てブロック。
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());

    // 初回オンボーディング（#141）が全画面で重ならないよう「見た」フラグを立てる。
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    });
  });

  test('猫をタップすると反応アニメーションが再生される', async ({ page }) => {
    // Math.random を固定して威嚇(hiss)を起こさせない（hiss だと演出を出さないため）。
    await page.addInitScript(() => { Math.random = () => 0.99; });
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    const catSvg = page.locator('#catStage .cat');
    await expect(catSvg).toBeVisible();

    // タップ直後は反応クラス（喜ぶ or しっぽふり）が付く。終了時に剥がれる前に確認する。
    await page.click('#catStage');
    await expect(catSvg).toHaveClass(/cat--(happy|wiggle)/);
  });

  test('威嚇(hiss)したときは喜び演出を出さず威嚇表情に差し替える（#187）', async ({ page }) => {
    // Math.random を 0 に固定して必ず hiss にする。
    await page.addInitScript(() => { Math.random = () => 0; });
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    const catSvg = page.locator('#catStage .cat');
    await expect(catSvg).toBeVisible();

    await page.click('#catStage');
    // 威嚇表情への一時差し替え（#187）：cat--hiss が付き、本体画像が hiss になる
    await expect(catSvg).toHaveClass(/cat--hiss/);
    await expect(page.locator('#catStage .cat__body')).toHaveAttribute('src', /cat_tora_low_hiss\.png/);
    // 反応クラスが付かないこと。誤って付くなら数百ms残るので、少し待ってから確認する。
    await page.waitForTimeout(300);
    await expect(catSvg).not.toHaveClass(/cat--(happy|wiggle)/);
  });

  test('サウンドOFFでも威嚇(hiss)なら喜び演出を出さない（音設定と演出の非結合）', async ({ page }) => {
    // Math.random を 0 に固定して必ず hiss にする。
    await page.addInitScript(() => { Math.random = () => 0; });
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    // サウンドをOFFにする（デフォルトON）。OFFでも威嚇判定は走るべき。
    await page.click('#soundToggle');

    const catSvg = page.locator('#catStage .cat');
    await expect(catSvg).toBeVisible();

    await page.click('#catStage');
    // ミュートでも hiss は抽選され、喜び演出は抑制される（抽選を再生から分離した修正）
    await page.waitForTimeout(300);
    await expect(catSvg).not.toHaveClass(/cat--(happy|wiggle)/);
  });

  test('きせかえ中に猫スタイルを切り替えられる（#66）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    // ピッカーはきせかえ編集モード中だけ出る
    await expect(page.locator('#stylePicker')).toBeHidden();
    await page.click('#dressupToggle');
    await expect(page.locator('#stylePicker')).toBeVisible();

    // しろ を選ぶと本体画像と data-style が切り替わる
    await page.click('.style-picker__btn[data-style="shiro"]');
    await expect(page.locator('#catStage .cat')).toHaveAttribute('data-style', 'shiro');
    await expect(page.locator('#catStage .cat__body')).toHaveAttribute('src', /cat_shiro_low_idle\.png/);

    // 「できた！」で抜けてもスタイルは維持され、ピッカーは隠れる
    await page.click('#dressupToggle');
    await expect(page.locator('#stylePicker')).toBeHidden();
    await expect(page.locator('#catStage .cat')).toHaveAttribute('data-style', 'shiro');
  });

  test('猫をなでる操作は記録ボタンとは別の安全操作（コインは増えない）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#statCoins')).toHaveText('0');

    // なでてもホームのまま、コインやストリークは変化しない（記録ではない）
    await page.click('#catStage');
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#statCoins')).toHaveText('0');
    await expect(page.locator('#statStreak')).toHaveText('0');
  });
});
