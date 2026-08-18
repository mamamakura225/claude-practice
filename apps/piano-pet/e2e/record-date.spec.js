import { test, expect } from '@playwright/test';

// 記録フォームの日付欄を変えたときのふるまい（#273）。
// #186 で「当日の記録画面は当日セッションから復元する」ようにしたため、日付だけ過去日へ
// 変えると当日ぶんのスタンプがそのまま過去日の記録として再計上され、コイン・XP が二重になっていた。
test.describe('記録フォームの日付変更（#273）', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
      Math.random = () => 0.999;   // きょうのおまけ（#148）を当選させずコインを固定値で検査する
    });
  });

  // 指定日数前の YYYY-MM-DD（ブラウザのローカル暦日で組む）
  const daysAgo = (page, n) => page.evaluate((days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, n);

  async function recordToday(page, count) {
    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    for (let i = 0; i < count; i += 1) await page.click('#stampCard');
    await expect(page.locator('#recordTotal')).toHaveText(String(count));
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();
  }

  const readState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')));

  test('日付を過去日に変えると当日ぶんのスタンプを持ち越さない（二重計上しない）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    await recordToday(page, 5);
    await expect(page.locator('#statCoins')).toHaveText('5');

    // 記録画面を開き直すと当日ぶん5スタンプが復元される（#186 の意図した挙動）
    await page.click('#goRecordBtn');
    await expect(page.locator('#recordTotal')).toHaveText('5');

    // 日付だけを過去日へ変えると、当日ぶんは持ち越されず空のカードから始まる
    await page.fill('#recordDate', await daysAgo(page, 2));
    await expect(page.locator('#recordTotal')).toHaveText('0');

    // 空のままでは記録できない（＝黙って当日ぶんが計上されることがない）
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#recordError')).toBeVisible();

    const st = await readState(page);
    expect(st.sessions.map((s) => s.totalCount)).toEqual([5]);
    expect(st.pet.coins).toBe(5);
    expect(st.pet.xp).toBe(5);
  });

  test('過去日には過去日ぶんだけが記録される', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    await recordToday(page, 5);
    const past = await daysAgo(page, 2);

    await page.click('#goRecordBtn');
    await page.fill('#recordDate', past);
    await expect(page.locator('#recordTotal')).toHaveText('0');
    await page.click('.song-chip');            // 復元済みの曲チップから選ぶ
    for (let i = 0; i < 3; i += 1) await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();

    const st = await readState(page);
    const byDate = Object.fromEntries(st.sessions.map((s) => [s.date, s.totalCount]));
    expect(byDate[past]).toBe(3);              // 5 が混ざらない
    expect(st.pet.coins).toBe(8);              // 5 + 3（どちらも10未満で達成ボーナスなし）
  });

  test('日付を今日へ戻すと当日ぶんが復元される（往復しても壊れない）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    await recordToday(page, 4);

    await page.click('#goRecordBtn');
    await expect(page.locator('#recordTotal')).toHaveText('4');
    await page.fill('#recordDate', await daysAgo(page, 1));
    await expect(page.locator('#recordTotal')).toHaveText('0');
    await page.fill('#recordDate', await daysAgo(page, 0));
    await expect(page.locator('#recordTotal')).toHaveText('4');
  });

  test('過去日を触っても当日の下書き（#164）は壊れない', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });

    // 当日の記録は未確定のまま3スタンプ押して下書きだけ作る
    await page.click('#goRecordBtn');
    await page.fill('#newSongInput', 'ちょうちょう');
    await page.click('#addSongBtn');
    for (let i = 0; i < 3; i += 1) await page.click('#stampCard');

    // 過去日へ切り替え → 戻す。当日の下書きは上書きされない
    await page.fill('#recordDate', await daysAgo(page, 3));
    await expect(page.locator('#recordTotal')).toHaveText('0');
    await page.fill('#recordDate', await daysAgo(page, 0));
    await expect(page.locator('#recordTotal')).toHaveText('3');

    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet:stamp-draft')));
    expect(draft.stamps).toEqual(['ちょうちょう', 'ちょうちょう', 'ちょうちょう']);
  });
});
