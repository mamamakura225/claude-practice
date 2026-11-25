import { test, expect, makeState, seed, readLocal, fixRandom, gotoHome } from './helpers.js';

// きせかえ：衣装のドラッグ（#168）・ピンチ拡縮（#205）・まえ／うしろ（#270）
test.describe('きせかえ 自由配置', () => {
  const ribbon = (page, layer = '') => page.locator(`#catStage ${layer} .cat__item[data-item="ribbon"]`);
  const layoutOf = async (page) => (await readLocal(page)).pet.itemLayout?.ribbon;

  // リボン(neck)を装備済みで編集モードに入る
  async function startEditing(page, pet = {}) {
    await seed(page, makeState({ pet: { equippedItems: ['ribbon'], itemLayout: {}, ...pet }, inventory: ['ribbon'] }));
    await gotoHome(page);
    await page.click('#dressupToggle');
    await expect(page.locator('#catStage')).toHaveClass(/cat-stage--editing/);
  }

  // ステージの (x, y) 割合の位置へドラッグする
  async function dragTo(page, x, y) {
    await page.locator('#catStage .cat').scrollIntoViewIfNeeded();   // パネル操作でスクロールしていることがある
    const stage = await page.locator('#catStage .cat').boundingBox();
    const box = await ribbon(page).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width * x, stage.y + stage.height * y, { steps: 8 });
    await page.mouse.up();
  }

  test('ドラッグした位置が itemLayout に記録され、既定の位置の近くでも吸着しない', { tag: '@compat' }, async ({ page }) => {
    await startEditing(page);
    await dragTo(page, 0.2, 0.2);
    const layout = await layoutOf(page);
    expect(layout.x_pct).toBeLessThan(40);
    expect(layout.y_pct).toBeLessThan(40);

    await dragTo(page, 0.5, 0.5);   // 首の既定位置（≒中央）の至近（位置スナップは廃止・#214）
    const back = await layoutOf(page);
    expect(back.x_pct).toBeGreaterThan(40);
    expect(back.x_pct).toBeLessThan(60);
  });

  // 2本指の入力は mouse で出せないので PointerEvent を直接撃つ（#325）
  test('ピンチ: 小さな揺れでは変わらず、超えた所から飛ばずに拡縮し、元の大きさに吸着、0.3〜3倍に収まる', async ({ page }) => {
    await startEditing(page);
    const scales = await page.evaluate(() => {
      const item = () => document.querySelector('#catStage .cat__item[data-item="ribbon"]');
      const box = item().getBoundingClientRect();
      const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
      const fire = (type, pointerId, dx) => item().dispatchEvent(new PointerEvent(type, {
        pointerId, clientX: cx + dx, clientY: cy, bubbles: true, cancelable: true,
      }));
      fire('pointerdown', 1, 0);
      fire('pointerdown', 2, 100);
      const at = (dx) => { fire('pointermove', 2, dx); return Number(item().dataset.scale); };
      const seen = { start: Number(item().dataset.scale), inDeadzone: at(109), justOver: at(111), twice: at(222), nearBase: at(114), max: at(2000), min: at(10) };
      fire('pointerup', 2, 10);
      fire('pointerup', 1, 0);
      return seen;
    });
    // 基準は首 0.8。デッドゾーン（10px）を超えた時点で基準を取り直すので、そこではまだ 0.8
    expect(scales).toEqual({ start: 0.8, inDeadzone: 0.8, justOver: 0.8, twice: 1.6, nearBase: 0.8, max: 3, min: 0.3 });
    const layout = await layoutOf(page);
    expect(layout.scale).toBe(0.3);
    expect(layout).toMatchObject({ x_pct: 50, y_pct: 50 });   // ピンチでは動かない
  });

  test('パネルでうしろへ送ると背面レイヤーに移り、ドラッグ後も layer が残る', async ({ page }) => {
    await startEditing(page);
    const chip = page.locator('#layerPanel .layer-panel__chip[data-item="ribbon"]');
    await expect(chip).toHaveAttribute('data-layer', 'front');
    // 編集中は本体が半透明＝うしろへ送ったアイテムが透けて見える
    await expect(page.locator('#catStage .cat__body')).toHaveCSS('opacity', '0.55');
    await expect(ribbon(page, '.cat__front')).toHaveCount(1);

    await chip.click();
    await expect(ribbon(page, '.cat__scene--back')).toHaveCount(1);
    await expect(ribbon(page, '.cat__front')).toHaveCount(0);
    expect((await layoutOf(page)).layer).toBe('back');

    await dragTo(page, 0.3, 0.3);
    const moved = await layoutOf(page);
    expect(moved.layer).toBe('back');
    expect(moved.x_pct).toBeLessThan(45);

    await page.click('#dressupToggle');
    await expect(page.locator('#layerPanel')).toBeHidden();
    await expect(page.locator('#catStage .cat__body')).toHaveCSS('opacity', '1');

    await page.reload();   // 起動時の描画にも保存した layer が効く
    await expect(ribbon(page, '.cat__scene--back')).toHaveCount(1);
    await expect(ribbon(page, '.cat__front')).toHaveCount(0);
  });

  // クラウド doc 由来の equippedItems に細工した文字列が入っていても、属性へ生で埋めない（#312）
  test('細工した equippedItems はレイヤーパネルに描画されず、スクリプトも走らない', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await startEditing(page, { equippedItems: ['ribbon', 'x" onmouseover="window.__pwned=1'] });
    await expect(page.locator('#layerPanel .layer-panel__chip')).toHaveCount(1);
    await expect(page.locator('#layerPanel .layer-panel__chip[data-item="ribbon"]')).toHaveCount(1);
    expect(await page.locator('#layerPanel *[onmouseover]').count()).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('編集モード中は猫タップで なで演出（喜び/しっぽふり）が出ない', async ({ page }) => {
    await fixRandom(page, 0.999);
    await startEditing(page);
    await page.click('#catStage');
    // クラスはタップと同時に付く。not.toHaveClass は剥がれる（1.2秒）まで待って通ってしまうので瞬間値で見る
    expect(await page.locator('#catStage .cat').getAttribute('class')).not.toMatch(/cat--(happy|wiggle)/);
  });
});
