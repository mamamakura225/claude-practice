import { test, expect } from '@playwright/test';

// 練習記録 → ホームのステータス反映（コイン・ストリーク）
test.describe('練習記録', () => {
  test.beforeEach(async ({ page }) => {
    // 本番Firestoreへの読み書きと干渉を防ぐためFirebase関連を全てブロック。
    // 取得失敗時はローカルのみで動作する設計なので、テストはまっさらな状態で進む。
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  });

  test('記録するとホームのコインとストリークが増える', { tag: '@compat' }, async ({ page }) => {
    await page.goto('/');

    // ホーム初期化を待つ（記録ボタンの出現＝アプリ起動）
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#statCoins')).toHaveText('0');

    // 記録画面へ
    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();

    // 曲を追加して選び、スタンプを5回押す（5かい）
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    for (let i = 0; i < 5; i += 1) {
      await page.click('#stampCard');
    }
    await expect(page.locator('#recordTotal')).toHaveText('5');

    // 記録する
    await page.click('#recordSubmitBtn');

    // ホームに戻り、コイン5・ストリーク1が反映される（1かい=1コイン、10未満なのでボーナス無し）
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#statCoins')).toHaveText('5');
    await expect(page.locator('#statStreak')).toHaveText('1');

    // 獲得コインのポップアップが出る
    await expect(page.locator('#coinPopupAmount')).toHaveText('+5');
  });

  test('合計0かいでは記録できずエラーが出る', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();

    // 何も入力せず記録 → エラー表示・ホームに遷移しない
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#recordError')).toBeVisible();
    await expect(page.locator('#view-record')).toBeVisible();
  });
});
