import { test, expect } from '@playwright/test';

// きせかえ：衣装をドラッグして自由配置・スナップ吸着（#168）
test.describe('きせかえ 自由配置', () => {
  test.beforeEach(async ({ page }) => {
    // 本番Firestoreへの読み書きと干渉を防ぐためFirebase関連を全てブロック（シード保護）。
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());

    // リボン(neck)を装備済みの状態で開始。
    await page.addInitScript(() => {
      localStorage.setItem(
        'piano-pet',
        JSON.stringify({
          version: 2,
          pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: ['ribbon'], itemLayout: {}, affinity: 0, foodSpent: 0 },
          inventory: ['ribbon'],
          streak: { current: 0, best: 0, lastPracticeDate: null, freezes: 0 },
          badges: [],
          sessions: [],
        }),
      );
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    });
  });

  // .cat__item を (toX,toY) 画面座標へ pointer ドラッグするヘルパー。
  async function dragItemTo(page, toX, toY) {
    const item = page.locator('#catStage .cat__item[data-item="ribbon"]');
    const box = await item.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(toX, toY, { steps: 8 });
    await page.mouse.up();
  }

  const itemLayout = (page) =>
    page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')).pet.itemLayout || {});

  test('編集モードで衣装を離れた位置へドラッグすると itemLayout に座標が記録される', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#catStage .cat__item[data-item="ribbon"]')).toBeVisible();

    // きせかえ編集モードに入る
    await page.click('#dressupToggle');
    await expect(page.locator('#catStage')).toHaveClass(/cat-stage--editing/);

    // ステージ左上寄り（既定の首アンカー≒中央から大きく離す）へドラッグ
    const stage = await page.locator('#catStage .cat').boundingBox();
    await dragItemTo(page, stage.x + stage.width * 0.2, stage.y + stage.height * 0.2);

    const layout = await itemLayout(page);
    expect(layout.ribbon).toBeTruthy();
    // 左上へ動かしたので 50%(中央)より小さい値に来ているはず
    expect(layout.ribbon.x_pct).toBeLessThan(40);
    expect(layout.ribbon.y_pct).toBeLessThan(40);
  });

  test('既定アンカーの近くにドロップしてもスナップせず座標を保持する（#214 位置スナップ廃止）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await page.click('#dressupToggle');

    const stage = await page.locator('#catStage .cat').boundingBox();
    // まず自由配置（左上）して layout に載せる
    await dragItemTo(page, stage.x + stage.width * 0.2, stage.y + stage.height * 0.2);
    expect((await itemLayout(page)).ribbon).toBeTruthy();

    // 首の既定アンカー（neck≒中央 x50% y50%）の至近へドロップしても、吸着で消えず座標が残る
    await dragItemTo(page, stage.x + stage.width * 0.5, stage.y + stage.height * 0.5);
    const layout = await itemLayout(page);
    expect(layout.ribbon).toBeTruthy();
    expect(layout.ribbon.x_pct).toBeGreaterThan(40);
    expect(layout.ribbon.x_pct).toBeLessThan(60);
  });

  // まえ／うしろパネル（#270）：チップのタップで描画レイヤーが入れ替わり、保存・ドラッグ後も残る。
  test('パネルでアイテムをうしろへ送ると背面レイヤーに移り、ドラッグ後も layer が残る', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await page.click('#dressupToggle');

    const chip = page.locator('#layerPanel .layer-panel__chip[data-item="ribbon"]');
    await expect(chip).toHaveAttribute('data-layer', 'front');
    // 編集中は本体が半透明＝うしろへ送ったアイテムが透けて見える（#270・#211 の再来防止）
    await expect(page.locator('#catStage .cat__body')).toHaveCSS('opacity', '0.55');
    await expect(page.locator('#catStage .cat__front .cat__item[data-item="ribbon"]')).toHaveCount(1);

    await chip.click();
    await expect(page.locator('#catStage .cat__scene--back .cat__item[data-item="ribbon"]')).toHaveCount(1);
    await expect(page.locator('#catStage .cat__front .cat__item[data-item="ribbon"]')).toHaveCount(0);
    expect((await itemLayout(page)).ribbon.layer).toBe('back');

    // 背面のまま編集中にドラッグしても layer は失われない（#270 dressup の引き継ぎ）
    // チップのクリックでページがスクロールしうるので、猫を画面内に戻してから座標を取る。
    await page.locator('#catStage .cat').scrollIntoViewIfNeeded();
    const stage = await page.locator('#catStage .cat').boundingBox();
    await dragItemTo(page, stage.x + stage.width * 0.3, stage.y + stage.height * 0.3);
    const moved = (await itemLayout(page)).ribbon;
    expect(moved.layer).toBe('back');
    expect(moved.x_pct).toBeLessThan(45);

    // 編集を抜けるとパネルは隠れ、本体は不透明に戻る
    await page.click('#dressupToggle');
    await expect(page.locator('#layerPanel')).toBeHidden();
    await expect(page.locator('#catStage .cat__body')).toHaveCSS('opacity', '1');
  });

  // 保存済みの layer が起動時の描画に効くこと（上の beforeEach は毎ナビゲーションで seed を
  // 書き戻すため、リロードではなく「layer 付きの state で開く」形で検証する）。
  test('保存済みの layer:back は起動時から背面レイヤーに描かれる', async ({ page }) => {
    await page.addInitScript(() => {
      const s = JSON.parse(localStorage.getItem('piano-pet'));
      s.pet.itemLayout = { ribbon: { x_pct: 40, y_pct: 45, layer: 'back' } };
      localStorage.setItem('piano-pet', JSON.stringify(s));
    });
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#catStage .cat__scene--back .cat__item[data-item="ribbon"]')).toHaveCount(1);
    await expect(page.locator('#catStage .cat__front .cat__item[data-item="ribbon"]')).toHaveCount(0);
  });

  test('編集モード中は猫タップでなで演出（喜び/しっぽふり）が出ない', async ({ page }) => {
    await page.addInitScript(() => { Math.random = () => 0.99; });  // hiss回避
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    await page.click('#dressupToggle');                 // 編集モードへ
    await page.click('#catStage');                       // 猫タップ
    await page.waitForTimeout(200);
    await expect(page.locator('#catStage .cat')).not.toHaveClass(/cat--(happy|wiggle)/);
  });
});
