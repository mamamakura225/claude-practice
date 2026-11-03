import { test, expect } from '@playwright/test';

// ごほうび演出の順番と長さ（#400）。動画のあいだはポップアップを出さず、見終わってから出す。
// バッジは2つ目以降を1枚にまとめる。reduced-motion でもハンコの手応えを残す。
// 動画の positive 再生は Chromium のみ（clip.spec.js の冒頭コメント参照）。

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayBefore = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return fmt(d); };

async function boot(page, state, random) {
  await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
  await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
  await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
  await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  await page.addInitScript(([s, r]) => {
    localStorage.setItem('piano-pet-onboarded', '1');
    localStorage.setItem('piano-pet', JSON.stringify(s));
    Math.random = () => r;
  }, [state, random]);
}

async function record(page, n) {
  await page.click('#goRecordBtn');
  await expect(page.locator('#view-record')).toBeVisible();
  await page.fill('#newSongInput', 'きらきらぼし');
  await page.click('#addSongBtn');
  for (let i = 0; i < n; i += 1) await page.click('#stampCard');
  await page.click('#recordSubmitBtn');
  await expect(page.locator('#view-home')).toBeVisible();
}

test.describe('ごほうび演出の順番（#400）', () => {
  test('動画のあいだはコインのポップアップを出さず、見終わる（スキップ）と出る', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', '動画の再生は Chromium のみで確認する');
    // 節目にならない通常の記録（clip.spec.js の seedPracticed と同じ形）。抽選は必ず当たり
    await boot(page, {
      pet: { name: 'きーちゃん', level: 1, xp: 8, coins: 8, equippedItems: [] },
      inventory: [],
      streak: { current: 1, best: 1, lastPracticeDate: dayBefore(1), freezes: 0 },
      badges: ['first_practice', 'practice_again'],
      sessions: [
        { date: dayBefore(3), songs: [{ name: 'きらきらぼし', count: 4 }], totalCount: 4 },
        { date: dayBefore(1), songs: [{ name: 'きらきらぼし', count: 4 }], totalCount: 4 },
      ],
    }, 0);
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await record(page, 3);
    const clip = page.locator('#catVideo');
    await expect(clip).toHaveClass(/cat-video--show/);
    await page.waitForTimeout(500);
    await expect(page.locator('#coinPopup')).toBeHidden();
    await clip.click();   // スキップ＝見終わったのと同じ
    await expect(page.locator('#coinPopup')).toBeVisible();
    await expect(page.locator('#coinPopupAmount')).toHaveText(/^\+\d+$/);
  });

  test('バッジが3つ以上取れたら、2つ目以降は1枚にまとめて出す', async ({ page }) => {
    // 資格は満たしているがバッジ未取得（累計100回・2日目）＝この記録で一度に複数取れる
    await boot(page, {
      pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [] },
      inventory: [], streak: { current: 0, best: 0, lastPracticeDate: null }, badges: [],
      sessions: [{ date: dayBefore(3), songs: [{ name: 'きらきらぼし', count: 100 }], totalCount: 100 }],
    }, 0.999);
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await record(page, 10);
    const gained = await page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')).badges.length);
    expect(gained, 'この記録で一度に3つ以上取れる前提').toBeGreaterThanOrEqual(3);
    // 2枚目（まとめ）は「・」でつながった名前になる
    await expect(page.locator('#badgePopupName')).toContainText('・', { timeout: 20000 });
    const name = await page.locator('#badgePopupName').textContent();
    expect(name.split('・')).toHaveLength(gained - 1);
    // まとめた後は続かず、閉じる
    await expect(page.locator('#badgePopup')).toBeHidden({ timeout: 5000 });
  });

  test('reduced-motion でもハンコに短い手応え（色の変化）が残る', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, {
      pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [] },
      inventory: [], streak: { current: 0, best: 0, lastPracticeDate: null }, badges: [],
      sessions: [{ date: dayBefore(5), songs: [{ name: 'きらきらぼし', count: 3 }], totalCount: 3 }],
    }, 0.999);
    await page.goto('/#/record');
    await expect(page.locator('#stampCard')).toBeVisible({ timeout: 10000 });
    await page.click('#stampCard');
    await page.click('#stampCard');
    const anims = await page.locator('.stamp-cell.is-filled').evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
    // いま押したマスだけ（全マスだと押すたびにカード全体が点滅する）
    expect(anims).toEqual(['none', 'stamp-fade']);
  });
  test('動画中にもう一度記録しても、前の記録のコインのポップアップは失われない', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', '動画の再生は Chromium のみで確認する');
    await boot(page, {
      pet: { name: 'きーちゃん', level: 1, xp: 8, coins: 8, equippedItems: [] },
      inventory: [],
      streak: { current: 1, best: 1, lastPracticeDate: dayBefore(1), freezes: 0 },
      badges: ['first_practice', 'practice_again'],
      sessions: [
        { date: dayBefore(3), songs: [{ name: 'きらきらぼし', count: 4 }], totalCount: 4 },
        { date: dayBefore(1), songs: [{ name: 'きらきらぼし', count: 4 }], totalCount: 4 },
      ],
    }, 0);
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    // コインのポップアップが一度でも出たかをページ内で数える（出た瞬間を取りこぼさない）
    await page.evaluate(() => {
      window.__coinShown = 0;
      new MutationObserver(() => { if (document.getElementById('coinPopup').classList.contains('coin-popup--show')) window.__coinShown += 1; })
        .observe(document.getElementById('coinPopup'), { attributes: true, attributeFilter: ['class'] });
    });
    await record(page, 3);
    await expect(page.locator('#catVideo')).toHaveClass(/cat-video--show/);
    // 動画中に記録画面へ（ホームを離れると動画は畳まれ、前の記録のポップアップが出る）
    await page.click('#goRecordBtn');
    await expect.poll(() => page.evaluate(() => window.__coinShown), { timeout: 8000 }).toBeGreaterThanOrEqual(1);
  });

  test('ポップアップはタップで次へ送れる', async ({ page }) => {
    await boot(page, {
      pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [] },
      inventory: [], streak: { current: 0, best: 0, lastPracticeDate: null }, badges: [], sessions: [],
    }, 0.999);
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
    await record(page, 3);
    await expect(page.locator('#coinPopup')).toBeVisible();
    await page.locator('#coinPopup').click();
    await expect(page.locator('#coinPopup')).toBeHidden({ timeout: 1000 });
  });
});
