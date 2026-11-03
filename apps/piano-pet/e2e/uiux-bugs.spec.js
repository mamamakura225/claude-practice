import { test, expect } from '@playwright/test';

// UI/UX 総点検で見つかった不具合の退行テスト（#396）。
const seed = (overrides = {}) => ({
  pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 200, equippedItems: [], childName: '', ...overrides.pet },
  inventory: overrides.inventory ?? [],
  streak: { current: 0, best: 0, lastPracticeDate: null },
  badges: overrides.badges ?? [],
  sessions: [],
});

async function boot(page, state, { onboarded = true } = {}) {
  await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
  await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
  await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
  await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  await page.addInitScript(([s, ob]) => {
    if (s) localStorage.setItem('piano-pet', JSON.stringify(s));
    if (ob) { try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ } }
    Math.random = () => 0.999;
  }, [state, onboarded]);
}

const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('UI点検の不具合（#396）', () => {
  test('320px＋長い名前でもヘッダーの ⚙️ が画面内に収まり、横スクロールしない', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await boot(page, seed({ pet: { childName: 'ながいなまえのこどもさん' } }));
    await page.goto('/');
    await expect(page.locator('#settingsToggle')).toBeVisible({ timeout: 10000 });
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
    const box = await page.locator('#settingsToggle').boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  });

  test('320px のショップで、ロック中のボタンがはみ出して横スクロールしない', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await boot(page, seed());
    await page.goto('/#/shop');
    await expect(page.locator('#shopList .shop-btn--locked').first()).toBeVisible({ timeout: 10000 });
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
  });

  test('「がめんの あかるさ」で選んでいるボタンが見た目で分かる（記録モードの切替に消されない）', async ({ page }) => {
    await boot(page, seed());
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    // 記録画面を一度開くと記録モードの表示同期が走る（ここでテーマ側の選択表示が消えていた）
    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();
    await page.click('#recordBackBtn');
    await page.click('#settingsToggle');
    await expect(page.locator('#settingsGate')).toBeVisible();
    const a = Number(await page.locator('#gateA').textContent());
    const b = Number(await page.locator('#gateB').textContent());
    await page.fill('#gateAnswer', String(a * b));
    await page.click('#gateSubmit');
    await expect(page.locator('#settingsMenu')).toBeVisible();
    await expect(page.locator('#themeSwitch [data-theme-choice="auto"]')).toHaveClass(/is-active/);
    await page.click('#themeSwitch [data-theme-choice="dark"]');
    await expect(page.locator('#themeSwitch [data-theme-choice="dark"]')).toHaveClass(/is-active/);
    await expect(page.locator('#themeSwitch [data-theme-choice="auto"]')).not.toHaveClass(/is-active/);
  });

  test('設定のエラー文は成功（緑）と違う色で出る', async ({ page }) => {
    await boot(page, seed());
    await page.goto('/');
    await expect(page.locator('#settingsToggle')).toBeVisible({ timeout: 10000 });
    const colors = await page.evaluate(() => {
      const mk = (cls) => {
        const el = document.createElement('p');
        el.className = cls;
        document.body.append(el);
        const c = getComputedStyle(el).color;
        el.remove();
        return c;
      };
      return { ok: mk('settings-menu__note'), err: mk('settings-menu__note settings-menu__note--error') };
    });
    expect(colors.err).not.toBe(colors.ok);
    expect(colors.err).toBe('rgb(214, 51, 108)');
  });

  test('同じ内容で記録し直しても「+0 コイン ゲット！」と祝わない', async ({ page }) => {
    await boot(page, seed());
    await page.goto('/');
    await page.click('#goRecordBtn');
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    for (let i = 0; i < 3; i += 1) await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#coinPopupLabel')).toHaveText('コイン ゲット！');
    await expect(page.locator('#coinPopup')).toBeHidden({ timeout: 5000 });

    // 当日の記録画面は当日ぶんで復元される → そのまま送信（回数は増えない）
    await page.click('#goRecordBtn');
    await expect(page.locator('#recordTotal')).toHaveText('3');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#coinPopup')).toBeVisible();
    await expect(page.locator('#coinPopupLabel')).toHaveText('きろくを なおしたよ');
    await expect(page.locator('#coinPopupAmount')).toBeHidden();
  });

  test('「かう」を続けて2回押しても、買ったものが勝手に みにつけられない', async ({ page }) => {
    await boot(page, seed());
    await page.goto('/#/shop');
    const buy = page.locator('.shop-btn[data-action="buy"][data-id="ribbon"]');
    await expect(buy).toBeVisible({ timeout: 10000 });
    await buy.scrollIntoViewIfNeeded();
    const box = await buy.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')));
    expect(st.inventory).toContain('ribbon');
    expect(st.pet.equippedItems).not.toContain('ribbon');
  });

  test('購入のバッジ表示は、続けて えさをあげると畳まれて重ならない', async ({ page }) => {
    await page.route('**/video/*_feed_*.mp4', (route) => route.abort());
    await boot(page, seed());
    await page.goto('/#/shop');
    await page.click('.shop-btn[data-action="buy"][data-id="ribbon"]');
    await expect(page.locator('#badgePopup')).toBeVisible();   // はじめての おきがえ
    await page.click('.shop-btn[data-action="feed"][data-id="fish"]');
    await expect(page.locator('#feedPopup')).toBeVisible();
    // バッジは 2.2秒で自然に消えるので、待たずにその瞬間の状態を見る
    expect(await page.locator('#badgePopup').isHidden()).toBe(true);
  });

  test('畳まれたえさやりカードの後続（バッジ告知）は失われず、あとで出る', async ({ page }) => {
    await page.route('**/video/*_feed_*.mp4', (route) => route.abort());
    await boot(page, seed({ pet: { affinity: 41 } }));   // あと1で なかよしMAX
    await page.goto('/#/shop');
    // 購入のバッジ（300ms 後）が、直後のえさやりカードを畳む
    await page.click('.shop-btn[data-action="buy"][data-id="ribbon"]');
    await page.click('.shop-btn[data-action="feed"][data-id="fish"]');
    await expect(page.locator('#badgePopupName')).toHaveText('おきがえ じょうず');
    await expect(page.locator('#badgePopupName')).toHaveText('ねこと だいの なかよし', { timeout: 8000 });
  });

  test('横向き（667x375）でもオンボーディングの「つぎへ」まで届く', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await boot(page, null, { onboarded: false });
    await page.goto('/');
    const next = page.locator('#onboardingNext');
    await expect(next).toBeVisible({ timeout: 10000 });
    const card = await page.locator('.onboarding__card').boundingBox();
    expect(card.y).toBeGreaterThanOrEqual(0);   // 上が切れない
    // media query が後ろの基本ルールに負けていない（ねこが縮んでいる）
    expect(await page.locator('.onboarding__cat').evaluate((el) => getComputedStyle(el).width)).toBe('72px');
    await next.scrollIntoViewIfNeeded();
    const btn = await next.boundingBox();
    expect(btn.y + btn.height).toBeLessThanOrEqual(375);
    await next.click();
    await expect(page.locator('#onboardingTitle')).toHaveText('ごほうびが もらえる');
  });
});
