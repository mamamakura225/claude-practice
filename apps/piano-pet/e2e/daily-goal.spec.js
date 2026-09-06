import { test, expect } from '@playwright/test';

// 1日の目標回数を親が調整（#238）。親ゲート内で 5〜20 に変更すると、ホームの進捗メーター・
// 記録画面のスタンプカードのマス数・分母表示に一貫反映される。達成ボーナス（コイン）には影響しない。
test.describe('目標回数の調整（#238）', () => {
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

  // 親ゲート（掛け算）を解いてメニューを開く。
  async function passGate(page) {
    await page.click('#settingsToggle');
    await expect(page.locator('#settingsGate')).toBeVisible();
    const a = Number(await page.locator('#gateA').textContent());
    const b = Number(await page.locator('#gateB').textContent());
    await page.fill('#gateAnswer', String(a * b));
    await page.click('#gateSubmit');
    await expect(page.locator('#settingsMenu')).toBeVisible();
  }

  test('既定は10で、親が15に変えるとホームと記録画面へ一貫反映される', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    // 既定10
    await expect(page.locator('#statGoalTarget')).toHaveText('10');

    // 親ゲート内で 15 に変更
    await passGate(page);
    await expect(page.locator('#goalTargetInput')).toHaveValue('10');
    await page.fill('#goalTargetInput', '15');
    await page.locator('#goalTargetInput').blur();
    await page.click('#settingsMenu [data-action="close-settings"]');

    // ホームの分母・aria-valuemax が 15 に追従
    await expect(page.locator('#statGoalTarget')).toHaveText('15');
    await expect(page.locator('#statGoalbar')).toHaveAttribute('aria-valuemax', '15');

    // 記録画面へ：スタンプカードが 15 マス、分母も 15
    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();
    await expect(page.locator('#stampCard .stamp-cell')).toHaveCount(15);
    await expect(page.locator('#recordGoalTarget')).toHaveText('15');
    // 目標マス（15マス目=index14）が is-goal
    await expect(page.locator('#stampCard .stamp-cell').nth(14)).toHaveClass(/is-goal/);
  });

  test('範囲外はクランプされる（＋で20を超えない）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await passGate(page);

    await page.fill('#goalTargetInput', '99');
    await page.locator('#goalTargetInput').blur();
    await expect(page.locator('#goalTargetInput')).toHaveValue('20');   // 上限20にクランプ
    await page.click('#settingsMenu [data-action="close-settings"]');
    await expect(page.locator('#statGoalTarget')).toHaveText('20');
  });

  // #322: goal 配線が単体・E2E とも既定値10でしか通っていなかった穴を埋める。
  // 目標を5に下げてから5回だけ記録し、DOM（#statGoalMsg / goal-block--done）まで
  // 一貫反映されることを検証する。
  test('目標を5に下げると5回でたっせい表示になる（#322）', async ({ page }) => {
    // きょうのおまけ（20%当選）と確率クリップ（最大70%）を外す。rng=1 は cat-video.js の
    // Fisher-Yates で範囲外スワップを起こしバッグを壊すため使わない（既存 clip.spec.js に揃える）。
    await page.addInitScript(() => { Math.random = () => 0.99; });
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    // 目標を5に変更
    await passGate(page);
    await page.fill('#goalTargetInput', '5');
    await page.locator('#goalTargetInput').blur();
    await page.click('#settingsMenu [data-action="close-settings"]');
    await expect(page.locator('#statGoalTarget')).toHaveText('5');

    // 記録前は未達
    await expect(page.locator('#goalBlock')).not.toHaveClass(/goal-block--done/);

    // 5回だけ記録（目標到達で必ずクリップが出る・#296。DOM反映は overlay の可視性に
    // 依存しないので待たない）
    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    for (let i = 0; i < 5; i += 1) await page.click('#stampCard');
    await expect(page.locator('#recordTotal')).toHaveText('5');
    await page.click('#recordSubmitBtn');

    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#statGoalCount')).toHaveText('5');
    await expect(page.locator('#statGoalTarget')).toHaveText('5');
    await expect(page.locator('#statGoalMsg')).toHaveText('もくひょう たっせい！🎉');
    await expect(page.locator('#goalBlock')).toHaveClass(/goal-block--done/);
    await expect(page.locator('#statGoalbar')).toHaveAttribute('aria-valuenow', '5');
    await expect(page.locator('#statGoalbar')).toHaveAttribute('aria-valuemax', '5');
    await expect(page.locator('#statGoalFill')).toHaveAttribute('style', /width:\s*100%/);

    // 目標到達で必ずクリップ（#296）が出ることは、crossedDailyGoal への goal 配線
    // （app.js の submitRecord 側）もあわせて担保する。初記録の first_practice バッジは
    // milestone 扱いだが、目標達成は milestone より優先されるので通常どおりクリップが出る。
    await expect(page.locator('#catVideo')).toHaveClass(/cat-video--show/);

    // 達成ボーナス（GOAL_BONUS_THRESHOLD=10・固定）は目標を下げても入らない：
    // 5回=5コインのみ（+5ボーナスも+3おまけも無い）
    await expect(page.locator('#statCoins')).toHaveText('5');
  });
});
