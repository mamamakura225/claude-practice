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

    // 初回オンボーディング（#141）が全画面で重ならないよう「見た」フラグを立てる。
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    });
  });

  test('購入して装備するとホームの猫にアイテムが乗る', { tag: '@compat' }, async ({ page }) => {
    await page.goto('/#/shop');

    // ショップ表示・所持コイン200
    await expect(page.locator('#shopCoins')).toHaveText('200', { timeout: 10000 });

    // 赤いリボン（25コイン）を買う → 残175
    await page.click('.shop-btn[data-action="buy"][data-id="ribbon"]');
    await expect(page.locator('#shopCoins')).toHaveText('175');

    // 装備する → 「みにつけてる」バッジが出る
    await page.click('.shop-btn[data-action="toggle"][data-id="ribbon"]');
    const ribbonCard = page.locator('.shop-card', { hasText: '赤いリボン' });
    await expect(ribbonCard.locator('.shop-card__badge')).toBeVisible();

    // ホームへ → 猫にアイテムグループが1つ乗る
    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#catStage .cat__front > g')).toHaveCount(1);
  });

  // 置物・小物系（シーン配置型・#226）：購入 → 配置 → ホームの猫の前後レイヤーに反映
  test('置物を買って「おく」とホームのシーンレイヤーに乗る（#226）', async ({ page }) => {
    await page.goto('/#/shop');
    await expect(page.locator('#shopCoins')).toHaveText('200', { timeout: 10000 });

    // けいとだま（40コイン・前面）を買う → 残160
    await page.click('.shop-btn[data-action="buy"][data-id="yarnBall"]');
    await expect(page.locator('#shopCoins')).toHaveText('160');

    // 「おく」（配置トグル）→ 「おうちに あるよ」バッジ
    await page.click('.shop-btn[data-action="place"][data-id="yarnBall"]');
    const yarnCard = page.locator('.shop-card', { hasText: 'けいとだま' });
    await expect(yarnCard.locator('.shop-card__badge')).toBeVisible();

    // ホームへ → 前面シーンレイヤー(z5)に毛糸玉、装備レイヤーは空
    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#catStage .cat__scene--front .cat__item[data-item="yarnBall"]')).toHaveCount(1);
    await expect(page.locator('#catStage .cat__front > g')).toHaveCount(0);
  });

  test('同じスロットのアイテムは付け替わる（リボン→星の首輪）', async ({ page }) => {
    // 星の首輪は unlockLevel 2（#126）。解放済みにするため affinity を盛る
    await page.addInitScript(() => {
      localStorage.setItem(
        'piano-pet',
        JSON.stringify({
          pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 200, equippedItems: [], affinity: 50, foodSpent: 0 },
          inventory: [],
          streak: { current: 0, best: 0, lastPracticeDate: null },
          badges: [],
          sessions: [],
        }),
      );
    });
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

    // 星の首輪が装備中、リボンは外れて「みにつける」に戻る
    await expect(
      page.locator('.shop-card', { hasText: '星の首輪' }).locator('.shop-card__badge'),
    ).toBeVisible();
    await expect(
      page.locator('.shop-card', { hasText: '赤いリボン' }).locator('.shop-btn'),
    ).toHaveText('みにつける');

    // ホームの猫に乗っているアイテムは1つ（付け替えなので増えない）
    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#catStage .cat__front > g')).toHaveCount(1);
  });

  test('えさをあげるとコインが減り なかよし度が上がる', async ({ page }) => {
    await page.goto('/#/shop');
    await expect(page.locator('#shopCoins')).toHaveText('200', { timeout: 10000 });
    await expect(page.locator('#feedAffinity')).toHaveText('0');

    // おさかな（5コイン・なかよし+1）をあげる → 残195・なかよし1
    await page.click('.shop-btn[data-action="feed"][data-id="fish"]');
    await expect(page.locator('#shopCoins')).toHaveText('195');
    await expect(page.locator('#feedAffinity')).toHaveText('1');

    // ホームの「なかよし」表示にも反映される
    await page.click('.nav-btn[data-nav="home"]');
    await expect(page.locator('#statAffinity')).toHaveText('1');
  });

  test('なかよしレベルとご褒美の解放が表示される（#124）', async ({ page }) => {
    // affinity=7 を仕込む（なかよしレベル3「だいすき」相当・#216 8段階）
    await page.addInitScript(() => {
      localStorage.setItem(
        'piano-pet',
        JSON.stringify({
          pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 200, equippedItems: [], affinity: 7, foodSpent: 0 },
          inventory: [],
          streak: { current: 0, best: 0, lastPracticeDate: null },
          badges: [],
          sessions: [],
        }),
      );
    });

    // ホーム：なかよしレベル3「だいすき」＋猫にエンブレムが付く
    await page.goto('/');
    await expect(page.locator('#statBondLevel')).toHaveText('3', { timeout: 10000 });
    await expect(page.locator('#statBondName')).toHaveText('だいすき');
    await expect(page.locator('#catStage .cat__bond')).toBeVisible();

    // ショップ：ご褒美リストで Lv1〜3 が解放済み（is-locked でない）。全8段階（#216）。
    await page.click('.nav-btn[data-nav="shop"]');
    await expect(page.locator('#bondRewards .bond-reward')).toHaveCount(8);
    await expect(page.locator('#bondRewards .bond-reward:not(.is-locked)')).toHaveCount(3);
    await expect(page.locator('#feedBondName')).toHaveText('だいすき');
  });

  test('コイン不足のアイテムは購入ボタンが無効', async ({ page }) => {
    // 王冠は unlockLevel 8（#126・#216）。解放はクリアしコイン不足だけを検証するため affinity を盛る。
    // 値下げ後（#250）の王冠は150コインなので、既定シードの200では足りてしまう→100で始める
    await page.addInitScript(() => {
      localStorage.setItem(
        'piano-pet',
        JSON.stringify({
          pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 100, equippedItems: [], affinity: 50, foodSpent: 0 },
          inventory: [],
          streak: { current: 0, best: 0, lastPracticeDate: null },
          badges: [],
          sessions: [],
        }),
      );
    });
    await page.goto('/#/shop');
    await expect(page.locator('#shopCoins')).toHaveText('100', { timeout: 10000 });

    // 王冠は150コインなので100では買えない
    const crownBtn = page.locator('.shop-card', { hasText: '王冠' }).locator('.shop-btn');
    await expect(crownBtn).toBeDisabled();
    await expect(crownBtn).toHaveText('コインが たりない');
  });

  test('なかよしLv未到達のアイテムはロック表示で買えない（#126）', async ({ page }) => {
    // 既定シードは affinity 0（なかよしLv1）。マフラー(Lv4)・王冠(Lv8)は未解放（#216）。
    await page.goto('/#/shop');
    await expect(page.locator('#shopCoins')).toHaveText('200', { timeout: 10000 });

    const scarfCard = page.locator('.shop-card', { hasText: 'マフラー' });
    const scarfBtn = scarfCard.locator('.shop-btn');
    await expect(scarfBtn).toBeDisabled();
    await expect(scarfBtn).toHaveText('なかよしLv4で あえる');
    await expect(scarfCard.locator('.shop-card__badge--locked')).toBeVisible();

    // ロック中は buy アクションのボタン自体が存在しない（誤購入できない）
    await expect(scarfCard.locator('.shop-btn[data-action="buy"]')).toHaveCount(0);

    // Lv1 のリボンは解放済みで買える
    await expect(
      page.locator('.shop-card', { hasText: '赤いリボン' }).locator('.shop-btn[data-action="buy"]'),
    ).toBeVisible();
  });
});
