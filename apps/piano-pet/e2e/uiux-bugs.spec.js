import { test, expect, makeState, seed, gotoHome } from './helpers.js';

// UI/UX 総点検で見つかった表示の不具合（#396）。画面ごとのものは各 spec に置く。
test('320px＋長い名前でもヘッダーの ⚙️ が画面内に収まり、横スクロールしない', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seed(page, makeState({ pet: { childName: 'ながいなまえのこどもさん' } }));
  await gotoHome(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const box = await page.locator('#settingsToggle').boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(320);
});

test('設定のエラー文は成功（緑）と違う色で出る', async ({ page }) => {
  await gotoHome(page);
  const [ok, err] = await page.evaluate(() => ['settings-menu__note', 'settings-menu__note settings-menu__note--error'].map((cls) => {
    const el = document.createElement('p');
    el.className = cls;
    document.body.append(el);
    const { color } = getComputedStyle(el);
    el.remove();
    return color;
  }));
  expect(err).not.toBe(ok);
});
