import { test, expect } from '@playwright/test';

// 記録・ショップ・きせかえへの導線（#399）。
const state = (coins, sessions = []) => ({
  pet: { name: 'きーちゃん', level: 1, xp: 0, coins, equippedItems: [] },
  inventory: [], streak: { current: 0, best: 0, lastPracticeDate: null }, badges: [], sessions,
});

async function boot(page, s) {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
  await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
  await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
  await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  await page.addInitScript((st) => {
    localStorage.setItem('piano-pet-onboarded', '1');
    localStorage.setItem('piano-pet', JSON.stringify(st));
  }, s);
}

// 下ナビ（68px）に隠れず、スクロールしなくても見えているか
async function inFirstScreen(page, sel) {
  const box = await page.locator(sel).boundingBox();
  const navTop = (await page.locator('.bottom-nav').boundingBox()).y;
  return box.y >= 0 && box.y + box.height <= navTop;
}

test.describe('導線（#399）', () => {
  test('ホームの「れんしゅうを きろくする」がスクロールしなくても見える', async ({ page }) => {
    await boot(page, state(0));
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    expect(await inFirstScreen(page, '#goRecordBtn')).toBe(true);
  });

  test('記録画面で10回押したあとも「きろくする」が下ナビに隠れない', async ({ page }) => {
    await boot(page, state(0, [{ date: '2026-10-01', songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 }]));
    await page.goto('/#/record');
    await expect(page.locator('#stampCard')).toBeVisible({ timeout: 10000 });
    // 送信ボタンはスタンプカードに重ねない（下段を押すと途中で記録されてしまう）
    const card = await page.locator('#stampCard').boundingBox();
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('#stampCard') != null, [card.x + card.width / 2, card.y + card.height - 8]);
    expect(hit).toBe(true);
    for (let i = 0; i < 10; i += 1) await page.click('#stampCard');
    // 目標に届いたら送信ボタンが見える位置まで動く
    await expect.poll(() => inFirstScreen(page, '#recordSubmitBtn')).toBe(true);
  });

  test('320x568 では記録ボタンを固定せず、きせかえ ボタンを覆わない', async ({ page }) => {
    await boot(page, state(0));
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    const b = await page.locator('#dressupToggle').boundingBox();
    const id = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.id, [b.x + b.width / 2, b.y + b.height / 2]);
    expect(id).toBe('dressupToggle');
  });

  test('いま押している曲の名前が出る', async ({ page }) => {
    await boot(page, state(0, [{ date: '2026-10-01', songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 }]));
    await page.goto('/#/record');
    await expect(page.locator('#stampSong')).toHaveText('🎵 いまは「きらきらぼし」', { timeout: 10000 });
    await page.fill('#newSongInput', 'かえるのうた');
    await page.click('#addSongBtn');
    await expect(page.locator('#stampSong')).toHaveText('🎵 いまは「かえるのうた」');
  });

  test('はじめての記録で曲が1つも無いときは、曲を入れるよう案内する', async ({ page }) => {
    await boot(page, state(0));
    await page.goto('/#/record');
    await expect(page.locator('#stampCard')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#stampSong')).toBeHidden();
    await page.click('#stampCard');
    await expect(page.locator('#stampHint')).toHaveText('おうちの ひとと、うえの らんに きょくの なまえを いれてね');
  });

  test('ごはん（最安5）にも届かないときだけ案内が出る', async ({ page }) => {
    await boot(page, state(5));
    await page.goto('/#/shop');
    await expect(page.locator('#shopList .shop-card').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#shopHint')).toBeHidden();
  });

  test('コインが足りないショップでは増やし方を案内し、記録画面へ行ける', async ({ page }) => {
    await boot(page, state(4));
    await page.goto('/#/shop');
    await expect(page.locator('#shopHint')).toBeVisible({ timeout: 10000 });
    await page.click('.shop-hint__btn');
    await expect(page.locator('#view-record')).toBeVisible();
  });

  test('コインがあれば案内は出ない。なかよし ごほうびは畳まれ、ロック品は買える物の後ろに並ぶ', async ({ page }) => {
    await boot(page, state(200));
    await page.goto('/#/shop');
    await expect(page.locator('#shopList .shop-card').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#shopHint')).toBeHidden();
    await expect(page.locator('.bond-rewards-box')).not.toHaveAttribute('open', '');
    const locked = await page.locator('#shopList .shop-card').evaluateAll((cards) =>
      cards.map((c) => c.classList.contains('shop-card--locked')));
    const firstLocked = locked.indexOf(true);
    expect(firstLocked).toBeGreaterThan(0);
    expect(locked.slice(firstLocked).every(Boolean)).toBe(true);
  });

  test('きせかえで何も持っていないときは、ショップへの案内が出る', async ({ page }) => {
    await boot(page, state(0));
    await page.goto('/');
    await page.click('#dressupToggle');
    await expect(page.locator('.layer-panel__hint')).toHaveText('まだ なにも つけていないよ。ショップで かってね');
    await page.click('.layer-panel__shop');
    await expect(page.locator('#view-shop')).toBeVisible();
    // きせかえ編集は終わっている（残すと戻ったとき ねこを なでられない）
    await expect(page.locator('#dressupToggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#catStage')).not.toHaveClass(/cat-stage--editing/);
  });
});
