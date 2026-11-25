import { test, expect } from '@playwright/test';

// ソース精読で見つけた不具合の退行テスト（#428）。
const ymd = (base, back = 0) => {
  const d = new Date(base); d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const NOON = new Date(); NOON.setHours(12, 0, 0, 0);
const session = (date, count, name = 'きらきらぼし') => ({ date, songs: [{ name, count }], totalCount: count });

async function boot(page, { sessions = [], pet = {}, badges = [], extra = {} } = {}, path = '/') {
  await page.route('**/www.gstatic.com/firebasejs/**', (route) => route.abort());
  await page.addInitScript(([state, ex]) => {
    Math.random = () => 0.999;   // おまけ・確率クリップを外す
    if (sessionStorage.getItem('seeded')) return;   // reload で seed し直さない
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('piano-pet-onboarded', '1');
    localStorage.setItem('piano-pet', JSON.stringify(state));
    for (const [k, v] of Object.entries(ex)) localStorage.setItem(k, v);
  }, [{
    pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [], ...pet },
    inventory: [],
    streak: { current: 0, best: 0, lastPracticeDate: sessions[0]?.date ?? null, freezes: 0 },
    badges: ['first_practice', 'practice_again', ...badges],
    sessions,
  }, extra]);
  await page.goto(path);
  await expect(page.locator('.view:not([hidden])')).toBeVisible({ timeout: 10000 });
}

const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')));
const comeBack = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

async function passGate(page) {
  await page.click('#settingsToggle');
  await expect(page.locator('#settingsGate')).toBeVisible();
  const a = Number(await page.locator('#gateA').textContent());
  const b = Number(await page.locator('#gateB').textContent());
  await page.fill('#gateAnswer', String(a * b));
  await page.click('#gateSubmit');
  await expect(page.locator('#settingsMenu')).toBeVisible();
}

test.describe('精読で見つけた不具合（#428）', () => {
  test('削除の猶予中に別の保存で確定しても、一覧の「なおす」は押した日の記録を開く', async ({ page }) => {
    await boot(page, { sessions: [session('2026-01-03', 4), session('2026-01-02', 3), session('2026-01-01', 2)] }, '/#/history');
    await expect(page.locator('.history-card')).toHaveCount(3);
    page.once('dialog', (d) => d.accept());
    await page.locator('.history-card').first().locator('[data-action="delete-session"]').click();
    await expect(page.locator('#undoToast')).toBeVisible();
    // アバターの変更（commitState）が、待っていた削除を確定する
    await page.locator('#view-history .child-avatar').click();
    await page.click('.avatar-grid__btn[data-avatar="rabbit"]');
    await page.click('#avatarOverlay .settings-btn');
    expect((await saved(page)).sessions).toHaveLength(2);
    const best = await page.locator('#historyStreakBest').textContent();

    await page.locator('.history-card[data-date="2026-01-02"] [data-action="edit-session"]').click();
    await expect(page.locator('#recordDate')).toHaveValue('2026-01-02');
    await expect(page.locator('#recordTotal')).toHaveText('3');
    expect(best).toBe('2');   // 上の数字も消したあとの値に描き直っている
  });

  test('今日の記録を別の日へ動かしたら、今日の記録画面に古い回数が戻らない', async ({ page }) => {
    const today = ymd(NOON);
    await page.clock.install({ time: NOON });
    await boot(page, { sessions: [session(today, 5)] }, '/#/record');
    await expect(page.locator('#recordTotal')).toHaveText('5');   // 当日ぶんの復元（#186）
    await page.click('.nav-btn[data-nav="history"]');
    await page.locator('.history-card [data-action="edit-session"]').click();
    await page.fill('#recordDate', ymd(NOON, 2));
    await page.click('#recordSubmitBtn');
    await expect(page.locator(`.history-card[data-date="${ymd(NOON, 2)}"]`)).toBeVisible();

    await page.click('.nav-btn[data-nav="home"]');
    await page.click('#goRecordBtn');
    await expect(page.locator('#recordTotal')).toHaveText('0');
  });

  test('しょきかしたら、書きかけのスタンプも残らない', async ({ page }) => {
    await page.clock.install({ time: NOON });
    await boot(page, { extra: { 'piano-pet:stamp-draft': JSON.stringify({ date: ymd(NOON), stamps: ['きらきらぼし', 'きらきらぼし'] }) } });
    await passGate(page);
    page.once('dialog', (d) => d.accept());
    const reloaded = page.waitForEvent('load');
    await page.click('#resetBtn');
    await reloaded;
    await page.click('#goRecordBtn');
    await expect(page.locator('#recordTotal')).toHaveText('0');
  });

  test('記録画面を開いたまま日付をまたいでも、復元した回数を二重に数えない', async ({ page }) => {
    const today = ymd(NOON);
    await page.clock.install({ time: NOON });
    await boot(page, { sessions: [session(today, 5)] }, '/#/record');
    await expect(page.locator('#recordTotal')).toHaveText('5');
    await page.clock.setSystemTime(new Date(NOON.getTime() + 86400000));
    await page.click('#stampCard');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-home')).toBeVisible();
    expect((await saved(page)).sessions.map((s) => [s.date, s.totalCount])).toEqual([[today, 6]]);   // 5+6=11 にならない
  });

  test('日付をまたいで戻ると、ホームの きょうの もくひょう と レッスンびが今日のものになる', async ({ page }) => {
    const tomorrow = new Date(NOON.getTime() + 86400000);
    await page.clock.install({ time: NOON });
    await boot(page, { sessions: [session(ymd(NOON), 10)], pet: { lessonDates: [ymd(tomorrow)] } });
    await expect(page.locator('#statGoalCount')).toHaveText('10');
    await page.clock.setSystemTime(tomorrow);
    await comeBack(page);
    await expect(page.locator('#statGoalCount')).toHaveText('0');
    await expect(page.locator('#statLessonToday')).toBeVisible();
    await expect(page.locator('#statStreak')).toHaveText('2');   // レッスンびが連続に入る
  });

  test('日付をまたいで戻ると、書きかけの無い記録画面は今日になり、書きかけは残る', async ({ page }) => {
    const tomorrow = new Date(NOON.getTime() + 86400000);
    await page.clock.install({ time: NOON });
    await boot(page, { sessions: [session(ymd(NOON), 5)] }, '/#/record');
    await page.clock.setSystemTime(tomorrow);
    await comeBack(page);
    await expect(page.locator('#recordDate')).toHaveValue(ymd(tomorrow));
    await expect(page.locator('#recordTotal')).toHaveText('0');

    await page.click('.song-chip');
    await page.click('#stampCard');
    await page.clock.setSystemTime(new Date(NOON.getTime() + 2 * 86400000));
    await comeBack(page);
    await expect(page.locator('#recordDate')).toHaveValue(ymd(tomorrow));
    await expect(page.locator('#recordTotal')).toHaveText('1');
  });

  test('目標回数の欄は、丸めた結果がいまの目標と同じでも表示が直る', async ({ page }) => {
    await boot(page, { pet: { dailyGoal: 5 } });
    await passGate(page);
    await page.fill('#goalTargetInput', '2');
    await page.locator('#goalTargetInput').blur();
    await expect(page.locator('#goalTargetInput')).toHaveValue('5');
  });

  test('日本語変換を確定する Enter では曲を追加しない', async ({ page }) => {
    await boot(page, {}, '/#/record');
    await page.fill('#newSongInput', 'きらき');
    const press = (init) => page.locator('#newSongInput').evaluate((el, i) => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...i }));
    }, init);
    await press({ isComposing: true });
    await expect(page.locator('.song-chip')).toHaveCount(0);
    await press({});
    await expect(page.locator('.song-chip')).toHaveText(['きらき']);
  });

  test('続けて獲得したバッジは、前のものを置き換えず順に出る', async ({ page }) => {
    // はなまる・ようす とも、あと1つで「ぜんぶ」がそろう
    await boot(page, { sessions: [
      { ...session('2026-01-05', 1), praise: 'hanamaru', tempo: 'slow' },
      { ...session('2026-01-03', 1), praise: 'jouzu', tempo: 'normal' },
      session('2026-01-01', 1),
    ] }, '/#/history');
    await page.evaluate(() => {
      window.__names = [];
      const el = document.getElementById('badgePopupName');
      new MutationObserver(() => window.__names.push([el.textContent, performance.now()])).observe(el, { childList: true });
    });
    const last = page.locator('.history-card[data-date="2026-01-01"]');
    await last.locator('[data-id="ganbatta"]').click();
    await last.locator('[data-id="fast"]').click();
    await expect(page.locator('#badgePopupName')).toHaveText('さんしょく テンポ', { timeout: 6000 });
    const names = await page.evaluate(() => window.__names);
    expect(names.map(([n]) => n)).toEqual(['いろんな きもち', 'さんしょく テンポ']);
    expect(names[1][1] - names[0][1]).toBeGreaterThan(2000);   // 1枚目も読める長さで出ている
  });

  test('記録直後（動画の読み込み中）に移動したら、見えないホームで動画を回さない', async ({ page }) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route('**/video/*_record_*.mp4', async (route) => { await gate; await route.continue(); });
    const primed = page.waitForRequest(/_record_.*mp4/);
    await boot(page, { pet: { dailyGoal: 5 } }, '/#/record');
    await page.fill('#newSongInput', 'きらきらぼし');
    await page.click('#addSongBtn');
    for (let i = 0; i < 5; i += 1) await page.click('#stampCard');   // 目標達成＝必ず動画
    await primed;   // 動画モジュールが読み込まれた
    await page.evaluate(() => {
      window.__clip = false;
      new MutationObserver(() => { window.__clip ||= document.body.classList.contains('cat-clip-playing'); })
        .observe(document.body, { attributes: true });
      document.getElementById('recordSubmitBtn').click();
      document.querySelector('.nav-btn[data-nav="shop"]').click();
    });
    release();
    // 出たとしても直ちに畳まれ、ごほうびのポップアップが待たされない
    await expect(page.locator('#coinPopup')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('body')).not.toHaveClass(/cat-clip-playing/);
  });

  test('もどるボタンの読み上げ・ナビの選択・あかるさの役割が、見えているものと合う', async ({ page }) => {
    await boot(page, { sessions: [session('2026-01-01', 1)] }, '/#/record');
    await expect(page.locator('#recordBackBtn')).toHaveAttribute('aria-label', 'ホームにもどる');
    await expect(page.locator('.nav-btn.active')).toHaveAttribute('aria-current', 'page');
    await page.click('.nav-btn[data-nav="history"]');
    await page.locator('[data-action="edit-session"]').click();
    await expect(page.locator('#recordBackBtn')).toHaveAttribute('aria-label', 'きろくにもどる');
    await expect(page.locator('#themeSwitch')).toHaveAttribute('role', 'group');   // 中は aria-pressed のトグル（radio ではない）
  });
});
