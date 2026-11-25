import { test, expect, session, makeState, seed, readLocal } from './helpers.js';

// きろく一覧の件数上限（#360）。全件を並べると1年で数万 px になり、下の操作が事実上たどれない。
test('きろく一覧は直近14件だけ出し、「もっと みる」で残りを足す', async ({ page }) => {
  await seed(page, makeState({   // 2026-01-01〜01-20（元配列は昇順）
    sessions: Array.from({ length: 20 }, (_, i) => session(`2026-01-${String(i + 1).padStart(2, '0')}`, i + 1)),
  }));
  await page.goto('/#/history');
  const cards = page.locator('#historyList .history-card');
  await expect(cards).toHaveCount(14);
  await expect(cards.first()).toContainText('1月20日');
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

  // 足したあとの行でも操作は正しい記録に当たる
  await cards.last().locator('[data-action="set-mark"][data-mark="praise"]').first().click();
  const st = await readLocal(page);
  expect(st.sessions.find((s) => s.date === '2026-01-01').praise).toBe('hanamaru');
  await expect(cards).toHaveCount(20);   // スタンプの再描画で畳まれない

  // 「なおす」→保存で戻ったときは畳まない（直した記録が見えなくならない）
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
