import { test, expect } from '@playwright/test';

// きろく画面と設定画面の整理（#401）。
const ymd = (back) => {
  const d = new Date(); d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const session = (back, name = 'きらきらぼし', count = 3) => ({ date: ymd(back), songs: [{ name, count }], totalCount: count });

async function boot(page, { sessions = [], pet = {} } = {}) {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
  await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
  await page.route('**/firebase.googleapis.com/**', (route) => route.abort());
  await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  await page.addInitScript(([ss, p]) => {
    localStorage.setItem('piano-pet-onboarded', '1');
    localStorage.setItem('piano-pet', JSON.stringify({
      pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [], ...p },
      inventory: [], streak: { current: 0, best: 0, lastPracticeDate: null }, badges: [], sessions: ss,
    }));
  }, [sessions, pet]);
}

async function passGate(page) {
  await page.click('#settingsToggle');
  await expect(page.locator('#settingsGate')).toBeVisible();
  const a = Number(await page.locator('#gateA').textContent());
  const b = Number(await page.locator('#gateB').textContent());
  await page.fill('#gateAnswer', String(a * b));
  await page.click('#gateSubmit');
  await expect(page.locator('#settingsMenu')).toBeVisible();
}

test.describe('きろく画面の整理（#401）', () => {
  test('カレンダー: 練習しなかった日は少ない日と色で見分けられる', async ({ page }) => {
    // 2日前=少ない日（1回・レベル1）、3日前=なし（レベル0）。同じ月に収まらない日付もあるので前月へは移らず、月内の2セルを比べる
    const d = new Date();
    test.skip(d.getDate() < 4, '月初は同じ月に過去の2日が無い');
    await boot(page, { sessions: [session(2, 'きらきらぼし', 1)] });
    await page.goto('/#/history');
    const low = page.locator(`#calGrid .cal-cell[data-date="${ymd(2)}"]`);
    await expect(low).toBeVisible({ timeout: 10000 });
    const none = page.locator('#calGrid .cal-cell[data-level="0"]:not(.cal-cell--future):not(.cal-cell--pad)').first();
    const bg = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg(none)).not.toBe(await bg(low));
    expect(await bg(none)).toBe('rgb(255, 255, 255)');   // 白抜き（旧実装は淡いピンク）
  });

  test('カレンダーの先の日は薄くしない（日付が読める）', async ({ page }) => {
    const d = new Date();
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    test.skip(d.getDate() === last, '月末は同じ月に先の日が無い');
    await boot(page);
    await page.goto('/#/history');
    const future = page.locator('#calGrid .cal-cell--future').first();
    await expect(future).toBeAttached({ timeout: 10000 });
    expect(await future.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  });

  test('カレンダーの日を押すと、一覧の表示件数の外でもその日の記録へ移る', async ({ page }) => {
    const sessions = Array.from({ length: 30 }, (_, i) => session(i + 1));
    await boot(page, { sessions });
    await page.goto('/#/history');
    await expect(page.locator('#calPrevBtn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#historyList .history-card')).toHaveCount(14);
    const target = ymd(28);   // 一覧の直近14件より古い日
    if (!(await page.locator(`#calGrid .cal-cell[data-date="${target}"]`).count())) await page.click('#calPrevBtn');
    await page.click(`#calGrid .cal-cell[data-date="${target}"]`);
    const card = page.locator(`#historyList .history-card[data-date="${target}"]`);
    await expect(card).toBeVisible();
    await expect(card).toBeInViewport();
    // 「なおす」へフォーカス（先頭のスタンプだと Enter で印が付く）
    expect(await page.evaluate(() => document.activeElement?.dataset.action)).toBe('edit-session');
  });

  test('「なおす」→「もどる」は きろく の元の位置へ戻り、編集中のナビは きろく', async ({ page }) => {
    const sessions = Array.from({ length: 10 }, (_, i) => session(i + 1));
    await boot(page, { sessions });
    await page.goto('/#/history');
    const edit = page.locator('[data-action="edit-session"]').nth(6);
    await expect(edit).toBeAttached({ timeout: 10000 });
    await edit.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => window.scrollY);
    expect(y).toBeGreaterThan(0);
    await edit.click();
    await expect(page.locator('#view-record')).toBeVisible();
    await expect(page.locator('.nav-btn[data-nav="history"]')).toHaveClass(/active/);
    await expect(page.locator('.nav-btn[data-nav="home"]')).not.toHaveClass(/active/);
    await expect(page.locator('.nav-btn[data-nav="history"]')).toHaveAttribute('aria-current', 'page');
    await page.click('#recordBackBtn');
    await expect(page.locator('#view-history')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);

    // 保存でも同じ位置へ戻る
    await edit.click();
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-history')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);

    // そのあと通常の記録画面を開くと、ナビは ホーム に戻っている
    await page.click('.nav-btn[data-nav="home"]');
    await page.click('#goRecordBtn');
    await expect(page.locator('.nav-btn[data-nav="home"]')).toHaveClass(/active/);
    await expect(page.locator('.nav-btn[data-nav="history"]')).not.toHaveClass(/active/);
  });

  test('日付を変えて保存すると、直した記録へ移る', async ({ page }) => {
    const sessions = Array.from({ length: 20 }, (_, i) => session(i + 1));
    await boot(page, { sessions });
    await page.goto('/#/history');
    await page.locator('[data-action="edit-session"]').nth(2).click();
    await expect(page.locator('#view-record')).toBeVisible();
    await page.fill('#recordDate', ymd(40));   // 表示範囲（直近14件）の外へ
    await page.locator('#recordDate').dispatchEvent('change');
    await page.click('#recordSubmitBtn');
    await expect(page.locator(`#historyList .history-card[data-date="${ymd(40)}"]`)).toBeInViewport();
  });

  test('「なおす」を経由しない記録画面の「もどる」はホームへ', async ({ page }) => {
    await boot(page);
    await page.goto('/#/record');
    await expect(page.locator('#recordBackBtn')).toBeVisible({ timeout: 10000 });
    await page.click('#recordBackBtn');
    await expect(page.locator('#view-home')).toBeVisible();
  });

  test('曲別コレクションは上位5曲で、「もっと みる」で全曲', async ({ page }) => {
    const sessions = ['あ', 'い', 'う', 'え', 'お', 'か', 'き'].map((n, i) => session(i + 1, n, 10 - i));
    await boot(page, { sessions });
    await page.goto('/#/history');
    const items = page.locator('.song-collection__item');
    await expect(items).toHaveCount(5, { timeout: 10000 });
    await expect(items.first()).toContainText('あ');
    await page.click('[data-action="more-songs"]');
    await expect(items).toHaveCount(7);
    await expect(page.locator('[data-action="more-songs"]')).toHaveCount(0);
    // ナビから入り直すと畳む
    await page.click('.nav-btn[data-nav="home"]');
    await page.click('.nav-btn[data-nav="history"]');
    await expect(items).toHaveCount(5);
  });

  test('記録カードのスタンプ2段に見出しがあり、回数の単位は「かい」', async ({ page }) => {
    await boot(page, { sessions: [session(1)] });
    await page.goto('/#/history');
    await expect(page.locator('.praise-row .mark-label')).toHaveText('はなまる', { timeout: 10000 });
    await expect(page.locator('.tempo-row .mark-label')).toHaveText('ようす');
    await page.goto('/#/record');
    await expect(page.locator('.stamp-progress')).toContainText('かい / もくひょう');
    await expect(page.locator('.stamp-progress')).not.toContainText('こ');
  });
});

test.describe('設定画面の整理（#401）', () => {
  test('レッスン日の一覧は過去3件で、「もっと みる」で増える。先の予定は全部出る', async ({ page }) => {
    const future = (() => { const d = new Date(); d.setDate(d.getDate() + 5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    const lessonDates = [ymd(12), ymd(10), ymd(8), ymd(6), ymd(4), future];
    await boot(page, { pet: { lessonDates } });
    await page.goto('/');
    await expect(page.locator('#settingsToggle')).toBeVisible({ timeout: 10000 });
    await passGate(page);
    await expect(page.locator('#lessonList .lesson-del')).toHaveCount(4);   // 予定1＋過去3
    await page.click('#lessonList .lesson-more');
    await expect(page.locator('#lessonList .lesson-del')).toHaveCount(6);
    await expect(page.locator('#lessonList .lesson-more')).toHaveCount(0);
  });

  test('古いレッスン日を入れ忘れで足すと、一覧を広げて見せる', async ({ page }) => {
    await boot(page, { pet: { lessonDates: [ymd(8), ymd(6), ymd(4), ymd(2)] } });
    await page.goto('/');
    await expect(page.locator('#settingsToggle')).toBeVisible({ timeout: 10000 });
    await passGate(page);
    await expect(page.locator('#lessonList .lesson-del')).toHaveCount(3);
    await page.fill('#lessonDateInput', ymd(20));
    await page.click('#lessonAddBtn');
    await expect(page.locator(`#lessonList .lesson-del[data-date="${ymd(20)}"]`)).toHaveCount(1);
  });

  test('せっていの「×」は上にあり、スクロールしても見えていて閉じられる', async ({ page }) => {
    await boot(page);
    await page.goto('/');
    await expect(page.locator('#settingsToggle')).toBeVisible({ timeout: 10000 });
    await passGate(page);
    const close = page.locator('.settings-panel__close');
    await expect(close).toBeInViewport();
    const scrolled = await page.locator('#settingsMenu').evaluate((el) => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
    expect(scrolled).toBeGreaterThan(0);   // 実際にスクロールした状態で sticky を確かめる
    await expect(close).toBeInViewport();
    const box = await close.boundingBox();
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(page.locator('#settingsOverlay')).toBeHidden();
  });
});
