import { test, expect } from '@playwright/test';

// きろく一覧の件数上限（#360）。全件を並べると1年で数万 px になり、下の操作が事実上たどれない。
test.describe('きろく一覧の件数上限', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
    await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      // 2026-01-01〜01-20 の20件（元配列は昇順）
      const sessions = Array.from({ length: 20 }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`, totalCount: i + 1, songs: [{ name: 'A', count: i + 1 }],
      }));
      localStorage.setItem('piano-pet', JSON.stringify({
        version: 2,
        pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [], placedItems: [], itemLayout: {}, affinity: 0, foodSpent: 0 },
        inventory: [], streak: { current: 0, best: 0, lastPracticeDate: null, freezes: 0 }, badges: [], sessions,
        settings: { soundOn: true },
      }));
    });
  });

  test('直近14件だけ出し、「もっと みる」で残りを足す', async ({ page }) => {
    await page.goto('/#/history');
    const cards = page.locator('#historyList .history-card');
    await expect(cards).toHaveCount(14);
    await expect(cards.first()).toContainText('1月20日');   // 新しい順の先頭
    await expect(cards.last()).toContainText('1月7日');

    const more = page.locator('#historyList [data-action="more-history"]');
    await expect(more).toHaveText('もっと みる（あと 6けん）');
    await more.click();
    await expect(cards).toHaveCount(20);
    await expect(more).toHaveCount(0);
    // 組み直しで body に落ちず、足した先頭（15件目＝1月6日）へフォーカスが移る
    await expect(page.locator(':focus')).toHaveCount(1);
    expect(await page.evaluate(() => document.activeElement.closest('.history-card')?.textContent ?? '')).toContain('1月6日');
    await expect(cards.last()).toContainText('1月1日');

    // 足したあとの行でも操作は正しい記録に当たる（data-index は元配列のまま）
    await cards.last().locator('[data-action="set-mark"][data-mark="praise"]').first().click();
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')));
    expect(st.sessions.find((s) => s.date === '2026-01-01').praise).toBe('hanamaru');
    await expect(cards).toHaveCount(20);   // スタンプの再描画で畳まれない

    // 15件目以降を「なおす」→保存で戻ったときは畳まない（直した記録が見えなくならない）
    await cards.last().locator('[data-action="edit-session"]').click();
    await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-history')).toBeVisible();
    await expect(cards).toHaveCount(20);

    // ナビから入り直すと直近14件へ戻る
    await page.click('.nav-btn[data-nav="home"]');
    await page.click('.nav-btn[data-nav="history"]');
    await expect(cards).toHaveCount(14);
  });
});
