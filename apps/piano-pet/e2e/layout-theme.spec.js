import { test, expect, ymd, session, makeState, seed } from './helpers.js';

// 横向き・ダークでの見た目の退行（#432）。スクショ比較はせず、押せる／読めることを計測で確かめる。
const boot = (page) => seed(page, makeState({ streak: { current: 1, best: 1, lastPracticeDate: ymd() }, sessions: [session(0, 10)] }));

test('横向きでも猫が下ナビに重ならず、タブを押せる', async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await boot(page);
  await page.goto('/');
  await expect(page.locator('#catStage .cat__body')).toBeVisible();
  // 猫と下ナビが同じ場所に来る配置であること（この前提が崩れるとテストが空振りする）
  const cat = await page.locator('#catStage .cat').boundingBox();
  const nav = await page.locator('.bottom-nav').boundingBox();
  expect(cat.y + cat.height).toBeGreaterThan(nav.y);
  const onTop = await page.locator('.nav-btn').evaluateAll((btns) => btns.map((b) => {
    const r = b.getBoundingClientRect();
    return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }));
  expect(onTop).toEqual([true, true, true, true, true]);
});

test.describe('ダーク', () => {
  test.use({ colorScheme: 'dark' });

  test('目標達成カードの文字が背景に沈まない', async ({ page }) => {
    await boot(page);
    await page.goto('/');
    await expect(page.locator('#goalBlock')).toHaveClass(/goal-block--done/);
    const ratio = await page.locator('#goalBlock').evaluate((block) => {
      const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = (c) => {
        const [r, g, b] = rgb(c).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const cs = getComputedStyle(block);
      const bg = cs.backgroundImage === 'none' ? cs.backgroundColor : cs.backgroundImage.match(/rgb\([^)]*\)/)[0];
      const [a, b] = [lum(getComputedStyle(block.querySelector('.goal-label')).color), lum(bg)].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
