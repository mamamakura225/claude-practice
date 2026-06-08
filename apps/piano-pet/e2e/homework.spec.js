import { test, expect } from '@playwright/test';

// 宿題ループ（きょうの きょく・#143）：親が設定 → ホーム表示 → 記録で達成演出。
test.describe('きょうの きょく（しゅくだい）', () => {
  test.beforeEach(async ({ page }) => {
    // 本番Firestoreへの読み書きと干渉を防ぐためFirebase関連を全てブロック。
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());

    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    });
  });

  // 親ゲート（掛け算・九九）を解いてメニューを開く。
  async function passGate(page) {
    await page.click('#settingsToggle');
    await expect(page.locator('#settingsGate')).toBeVisible();
    const a = Number(await page.locator('#gateA').textContent());
    const b = Number(await page.locator('#gateB').textContent());
    await page.fill('#gateAnswer', String(a * b));
    await page.click('#gateSubmit');
    await expect(page.locator('#settingsMenu')).toBeVisible();
  }

  test('親が宿題を設定するとホームにカードが出る', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    // 宿題が無いうちはカードは隠れている
    await expect(page.locator('#assignmentCard')).toBeHidden();

    await passGate(page);
    await page.fill('#hwName', 'きらきらぼし');
    await page.fill('#hwTarget', '5');
    await page.click('#hwSaveBtn');

    // ホームのカードが出て、曲名・進捗が表示される
    await page.click('#settingsMenu [data-action="close-settings"]');
    const card = page.locator('#assignmentCard');
    await expect(card).toBeVisible();
    await expect(page.locator('#assignmentBadge')).toHaveText('🎀 きょうの きょく');
    await expect(page.locator('#assignmentName')).toHaveText('きらきらぼし');
    await expect(page.locator('#assignmentMsg')).toHaveText('0 / 5 かい（あと 5）');
  });

  test('目標到達で達成演出（ポップアップ）が出る', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    // 宿題を設定（きらきらぼし 3かい）
    await passGate(page);
    await page.fill('#hwName', 'きらきらぼし');
    await page.fill('#hwTarget', '3');
    await page.click('#hwSaveBtn');
    await page.click('#settingsMenu [data-action="close-settings"]');

    // 記録：きらきらぼしを3かい押す → 目標到達
    await page.click('#goRecordBtn');
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    // 各スタンプの登録を #recordTotal で待ってから次を押す。
    // 連打すると遅いCIでクリックが取りこぼされ count<3＝達成未検出になり、
    // 達成ポップアップが発火せず曲名が空になる（#143 フレーキーの真因）。
    for (let i = 0; i < 3; i += 1) {
      await page.click('#stampCard');
      await expect(page.locator('#recordTotal')).toHaveText(String(i + 1));
    }
    await page.click('#recordSubmitBtn');

    // ホームのカードが達成状態になる
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#assignmentMsg')).toHaveText('やったね！しゅくだい たっせい！🎉');
    await expect(page.locator('#assignmentCard')).toHaveClass(/assignment-card--done/);

    // 達成ポップアップが曲名つきで出る。コイン→ボーナス→お休み券→バッジの後に
    // setTimeout 累積（最悪 2200×4≒8800ms）でディレイ表示されるため余裕を持って待つ。
    // .coin-popup は常時 display:flex（可視は coin-popup--show=opacity で制御）なので
    // toBeVisible では実際の表示を検知できない。表示クラスの付与で「本当に出た」ことを待つ。
    await expect(page.locator('#assignmentPopup')).toHaveClass(/coin-popup--show/, { timeout: 15000 });
    await expect(page.locator('#assignmentPopupSong')).toHaveText('きらきらぼし');
  });

  test('「けす」で宿題を消すとカードが隠れる', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    await passGate(page);
    await page.fill('#hwName', 'ちょうちょ');
    await page.click('#hwSaveBtn');
    await page.click('#settingsMenu [data-action="close-settings"]');
    await expect(page.locator('#assignmentCard')).toBeVisible();

    // 再度ゲートを通って「けす」
    await passGate(page);
    await page.click('#hwClearBtn');
    await page.click('#settingsMenu [data-action="close-settings"]');
    await expect(page.locator('#assignmentCard')).toBeHidden();
  });
});
