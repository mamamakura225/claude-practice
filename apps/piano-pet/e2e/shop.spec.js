import { test, expect } from '@playwright/test';

// ショップ：購入 → 装備 → ホームの猫に反映
test.describe('ショップ', () => {
  test.beforeEach(async ({ page }) => {
    // 本番Firestoreへの読み書きと干渉を防ぐためFirebase関連を全てブロック。
    // （クラウド取得が成功すると下のシード状態を上書きしてしまうため必須）
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());

    // コインを持った状態で開始（記録を経由せずショップ単体を検証するため）
    await page.addInitScript(() => {
      localStorage.setItem(
        'piano-pet',
        JSON.stringify({
          pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 200, equippedItems: [] },
          inventory: [],
          streak: { current: 0, best: 0, lastPracticeDate: null },
          badges: [],
          sessions: [],
        }),
      );
    });
  });

  test('購入して装備するとホームの猫にアイテムが乗る', async ({ page }) => {
    await page.goto('/#/shop');

    // ショップ表示・所持コイン200
    await expect(page.locator('#shopCoins')).toHaveText('200', { timeout: 10000 });

    // 赤いリボン（50コイン）を買う → 残150
    await page.click('.shop-btn[data-action="buy"][data-id="ribbon"]');
    await expect(page.locator('#shopCoins')).toHaveText('150');

    // 装備する → 「そうび中」バッジが出る
    await page.click('.shop-btn[data-action="toggle"][data-id="ribbon"]');
    const ribbonCard = page.locator('.shop-card', { hasText: '赤いリボン' });
    await expect(ribbonCard.locator('.shop-card__badge')).toBeVisible();

    // ホームへ → 猫にアイテムグループが1つ乗る
    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#catStage .cat__items > g')).toHaveCount(1);
  });

  test('同じスロットのアイテムは付け替わる（リボン→星の首輪）', async ({ page }) => {
    await page.goto('/#/shop');
    await expect(page.locator('#shopCoins')).toHaveText('200', { timeout: 10000 });

    // リボン購入＆装備
    await page.click('.shop-btn[data-action="buy"][data-id="ribbon"]');
    await page.click('.shop-btn[data-action="toggle"][data-id="ribbon"]');
    await expect(
      page.locator('.shop-card', { hasText: '赤いリボン' }).locator('.shop-card__badge'),
    ).toBeVisible();

    // 星の首輪購入＆装備（どちらも首スロット）
    await page.click('.shop-btn[data-action="buy"][data-id="collar"]');
    await page.click('.shop-btn[data-action="toggle"][data-id="collar"]');

    // 星の首輪が装備中、リボンは外れて「そうびする」に戻る
    await expect(
      page.locator('.shop-card', { hasText: '星の首輪' }).locator('.shop-card__badge'),
    ).toBeVisible();
    await expect(
      page.locator('.shop-card', { hasText: '赤いリボン' }).locator('.shop-btn'),
    ).toHaveText('そうびする');

    // ホームの猫に乗っているアイテムは1つ（付け替えなので増えない）
    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#catStage .cat__items > g')).toHaveCount(1);
  });

  test('コイン不足のアイテムは購入ボタンが無効', async ({ page }) => {
    await page.goto('/#/shop');
    await expect(page.locator('#shopCoins')).toHaveText('200', { timeout: 10000 });

    // 王冠は300コインなので200では買えない
    const crownBtn = page.locator('.shop-card', { hasText: '王冠' }).locator('.shop-btn');
    await expect(crownBtn).toBeDisabled();
    await expect(crownBtn).toHaveText('コインが たりない');
  });
});
