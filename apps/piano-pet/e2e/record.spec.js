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

    // 初回オンボーディング（#141）は全画面で重なり操作を遮るので、既存導線テストでは
    // 「見た」フラグを立てて出さない（オンボーディング自体は onboarding.spec.js で検証）。
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
      // きょうのおまけ（#148）は Math.random 由来で約20%当選し獲得コインが揺れる。
      // 記録テストはコインを固定値で検査するため、乱数を固定して当選しない（>=0.2）ようにする。
      Math.random = () => 0.999;
    });
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

    // きろく画面の「きょくべつ コレクション」に曲と累計回数が出る（#122）
    await page.click('.nav-btn[data-nav="history"]');
    await expect(page.locator('#view-history')).toBeVisible();
    const item = page.locator('#songCollection .song-collection__item');
    await expect(item).toHaveCount(1);
    await expect(item.locator('.song-collection__name')).toHaveText('きらきらぼし');
    await expect(item.locator('.song-collection__count')).toHaveText('5かい');
  });

  test('まとめモードで曲×回数を入力して記録できる', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#statCoins')).toHaveText('0');

    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();

    // まとめモードへ切替（スタンプを押さずに入力する）
    await page.click('#modeBatchBtn');
    await expect(page.locator('#batchMode')).toBeVisible();
    await expect(page.locator('#stampMode')).toBeHidden();

    // 1行目：きらきらぼし 7かい
    const firstRow = page.locator('.batch-row').first();
    await firstRow.locator('.batch-row__name').fill('きらきらぼし');
    await firstRow.locator('.batch-row__count').fill('7');

    // 2行目を増やして ちょうちょ 3かい
    await page.click('#addBatchRowBtn');
    const secondRow = page.locator('.batch-row').nth(1);
    await secondRow.locator('.batch-row__name').fill('ちょうちょ');
    await secondRow.locator('.batch-row__count').fill('3');

    // ごうけい 10かい（目標達成 → ボーナス +5コイン +XP）
    await expect(page.locator('#batchTotal')).toHaveText('10');

    await page.click('#recordSubmitBtn');

    // ホームに戻り、10かい=10コイン + 目標達成ボーナス5 = 15コイン
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#statCoins')).toHaveText('15');
    await expect(page.locator('#statStreak')).toHaveText('1');
  });

  test('スタンプは当日ホームに戻っても引き継がれる（#164）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();

    // 曲を選んでスタンプを3回押す
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    for (let i = 0; i < 3; i += 1) await page.click('#stampCard');
    await expect(page.locator('#recordTotal')).toHaveText('3');

    // ホームに戻ってから記録画面を開き直す
    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#view-home')).toBeVisible();
    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();

    // 0からリスタートせず3個のまま引き継がれている
    await expect(page.locator('#recordTotal')).toHaveText('3');
    await expect(page.locator('#stampCard .stamp-cell.is-filled')).toHaveCount(3);

    // 記録しても当日は引き継ぐ：再度開くと0ではなく当日の3個から続けられる（#186）
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();
    await page.click('#goRecordBtn');
    await expect(page.locator('#recordTotal')).toHaveText('3');
  });

  test('当日中はスタンプを継続でき、同日同曲は1レコードに合算される（#186）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    // 1回目：きらきらぼしを2回押して記録
    await page.click('#goRecordBtn');
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    for (let i = 0; i < 2; i += 1) await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();

    // 2回目：当日カウント(2)を引き継いだ状態から続けて1回押して記録
    await page.click('#goRecordBtn');
    await expect(page.locator('#recordTotal')).toHaveText('2');
    await page.click('#stampCard');
    await expect(page.locator('#recordTotal')).toHaveText('3');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();

    // きろくタブ：同日同曲が1行「きらきらぼし 3かい」に合算される（二重計上しない）
    await page.click('.nav-btn[data-nav="history"]');
    const card = page.locator('.history-card').first();
    await expect(card.locator('.history-card__total')).toContainText('3');
    await expect(card.locator('.history-songs li')).toHaveCount(1);
    await expect(card.locator('.history-songs li').first()).toContainText('きらきらぼし');
    await expect(card.locator('.history-songs li').first()).toContainText('3かい');
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

  // manifest shortcuts（#235）の飛び先。ホームを経由せず記録画面が直接開くこと。
  // shortcut の url（./index.html#/record）は起動時の router.syncFromHash が解決する。
  test('#/record で起動するとホームを経由せず記録画面が開く（#235）', async ({ page }) => {
    await page.goto('/index.html#/record');

    await expect(page.locator('#view-record')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#view-home')).toBeHidden();
    await expect(page.locator('#recordForm')).toBeVisible();
  });
});
