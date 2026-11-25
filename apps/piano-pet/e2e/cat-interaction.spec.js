import { test, expect, fixRandom, gotoHome } from './helpers.js';

// ホームで猫をなでる/タップする（#79）・猫スタイル（#66）
test.describe('猫とのインタラクション', () => {
  test('タップすると反応アニメーションが出るだけで、コインも連続日数も増えない', async ({ page }) => {
    await fixRandom(page, 0.999);   // 威嚇(hiss)を外す
    await gotoHome(page);
    await page.click('#catStage');
    await expect(page.locator('#catStage .cat')).toHaveClass(/cat--(happy|wiggle)/);
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#statCoins')).toHaveText('0');
    await expect(page.locator('#statStreak')).toHaveText('0');
  });

  // 威嚇の抽選は再生と分離してある＝音を切っていても同じに出る（#187）
  for (const sound of ['ON', 'OFF']) {
    test(`音 ${sound}: 威嚇(hiss)のときは威嚇の表情に差し替え、喜びの演出は出さない`, async ({ page }) => {
      await fixRandom(page, 0);
      await gotoHome(page);
      if (sound === 'OFF') await page.click('#soundToggle');
      const cat = page.locator('#catStage .cat');
      // 反応クラスが一瞬でも付いたら拾う（あとで見ると、剥がれたのか付かなかったのか区別できない）
      await cat.evaluate((el) => {
        window.__classes = [];
        new MutationObserver(() => window.__classes.push(el.className)).observe(el, { attributes: true, attributeFilter: ['class'] });
      });
      await page.click('#catStage');
      await expect(cat).toHaveClass(/cat--hiss/);
      await expect(page.locator('#catStage .cat__body')).toHaveAttribute('src', /cat_tora_low_hiss\.webp/);
      await expect(cat).not.toHaveClass(/cat--hiss/);   // 元の表情に戻る
      const reacted = await page.evaluate(() => window.__classes.filter((c) => /cat--(happy|wiggle)/.test(c)));
      expect(reacted).toEqual([]);
    });
  }

  test('きせかえ中に猫スタイルを切り替えられる（#66）', async ({ page }) => {
    await gotoHome(page);
    await expect(page.locator('#stylePicker')).toBeHidden();   // きせかえ編集中だけ出る
    await page.click('#dressupToggle');
    await page.click('.style-picker__btn[data-style="shiro"]');
    await expect(page.locator('#catStage .cat')).toHaveAttribute('data-style', 'shiro');
    await expect(page.locator('#catStage .cat__body')).toHaveAttribute('src', /cat_shiro_low_idle\.webp/);

    await page.click('#dressupToggle');   // 「できた！」で抜けても維持される
    await expect(page.locator('#stylePicker')).toBeHidden();
    await expect(page.locator('#catStage .cat')).toHaveAttribute('data-style', 'shiro');
  });
});
