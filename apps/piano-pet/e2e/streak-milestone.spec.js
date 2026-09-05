import { test, expect } from '@playwright/test';

// 連続日数の節目と記録クリップ（#305）。
// `leveled` / `badgeCount` は「その記録で起きたこと」なのに、連続日数だけは
// STREAK_CELEBRATIONS.has(streakCurrent) ＝「その値であるあいだずっと真」の状態を見ていた。
// そのため節目の日（3/7/14/30/50/100日目）は**その日の全記録**が節目扱いになり、
// 目標到達の1本を除いてクリップが一本も出なくなっていた。

test.describe('連続日数の節目とクリップ（#305）', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    });
  });

  // 昨日・一昨日に練習済み＝今日の初回記録で連続3日目（節目）に到達する状態。
  // 節目バッジ（streak_3）と practice_again（#309・記録2日目で取得）は取得済みにして、
  // badgeCount 由来の節目と混ざらないようにする（sessions と badges の不整合はここで
  // 新規バッジを誤って newlyEarned させ、このテストが検証している節目判定を汚染する）。
  async function seedStreak2(page) {
    await page.addInitScript(() => {
      const p = (n) => String(n).padStart(2, '0');
      const day = (back) => {
        const d = new Date(); d.setDate(d.getDate() - back);
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      };
      localStorage.setItem('piano-pet', JSON.stringify({
        pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 200, equippedItems: [], catStyle: 'shiro' },
        inventory: [],
        streak: { current: 2, best: 2, lastPracticeDate: day(1), freezes: 0 },
        badges: ['first_practice', 'practice_again', 'streak_3'],
        sessions: [
          { date: day(1), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 },
          { date: day(2), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 },
        ],
      }));
    });
  }

  async function recordOnce(page, { addSong }) {
    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();
    if (addSong) {
      await page.fill('#newSongInput', 'きらきらぼし');
      await page.click('#addSongBtn');
    }
    for (let i = 0; i < 3; i += 1) await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();
    // クリップが出るなら cat-video--show が付く。出ないなら付かないまま。
    return page.locator('#catVideo').evaluate((el) => new Promise((resolve) => {
      const t = setTimeout(() => resolve(el.classList.contains('cat-video--show')), 3000);
      const check = () => { if (el.classList.contains('cat-video--show')) { clearTimeout(t); resolve(true); } };
      check();
      new MutationObserver(check).observe(el, { attributes: true, attributeFilter: ['class'] });
    }));
  }

  test('節目に到達した記録は動画を出さず、同じ日の2回目からは出る', async ({ page }) => {
    await seedStreak2(page);
    await page.addInitScript(() => { Math.random = () => 0; });   // 抽選は必ず当たり
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    // 1回目：連続2→3日で節目に到達。動画ではなく playCelebrate。
    const first = await recordOnce(page, { addSong: true });
    expect(first, '節目に到達した記録では動画を出さない').toBe(false);
    await expect(page.locator('#streakValue, #homeStreak')).toBeVisible().catch(() => {});

    await page.locator('#catVideo').click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);

    // 2回目：連続日数は3のまま＝この記録では伸びていないので節目ではない。
    // 修正前はここも節目扱いになり、その日は二度と動画が出なかった。
    const second = await recordOnce(page, { addSong: false });
    expect(second, '節目の日でも2回目の記録では抽選どおり動画が出る').toBe(true);
  });

  test('連続日数が節目でない日は従来どおり2回目も出る（退行していないこと）', async ({ page }) => {
    await page.addInitScript(() => {
      const p = (n) => String(n).padStart(2, '0');
      const day = (back) => {
        const d = new Date(); d.setDate(d.getDate() - back);
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      };
      localStorage.setItem('piano-pet', JSON.stringify({
        pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 200, equippedItems: [], catStyle: 'shiro' },
        inventory: [],
        streak: { current: 4, best: 4, lastPracticeDate: day(1), freezes: 0 },
        badges: ['first_practice', 'practice_again', 'streak_3'],
        sessions: [
          { date: day(1), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 },
          { date: day(2), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 },
          { date: day(3), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 },
          { date: day(4), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 },
        ],
      }));
    });
    await page.addInitScript(() => { Math.random = () => 0; });
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    await recordOnce(page, { addSong: true });
    await page.locator('#catVideo').click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    const second = await recordOnce(page, { addSong: false });
    expect(second, '節目でない日は2回目も動画が出る').toBe(true);
  });
});
