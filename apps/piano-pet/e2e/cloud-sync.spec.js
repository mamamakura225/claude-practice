import { test, expect } from '@playwright/test';

// クラウド同期の取り込み経路（#142 初回 / #242 復帰時 resync / realtime）。
//
// 他の spec は Firestore を route.abort で遮断しているため、app.js 側の
// initCloudSync / reconcileInitialCloud / applyRemoteState / resyncFromCloud は
// 一度も実行されていなかった（データ損失系という最高リスク領域が退行検知できない状態）。
// ここでは ./js/cloud.js への **リクエストを差し替えて偽モジュールを配る**ことで、
// アプリ側のコードには一切手を入れずに実経路を通す。
// 挙動の仕様は docs/data-model.md「取り込み経路は3つあり、規則が同じではない」。

// 偽 cloud.js。クラウド doc は window.__cloudDoc に置き、push は同じ場所へ書き戻す。
// subscribeCloud のコールバックは window.__onRemote に生やし、テストから realtime を撃てるようにする。
// debounce キューは本物（cloud-queue.js は firebase 非依存）を使う＝#313 の thunk 化・
// 保留中マージが実経路で通る。delay は 0 にして既存テストの即時性を保ちつつ、
// window.__cloudDelay を入れた個別テストだけ本来の遅延で回す。
const FAKE_CLOUD = `
import { createCloudQueue } from './cloud-queue.js';
export async function fetchCloud() {
  return window.__cloudDoc ?? null;
}
export async function pushCloud(data) {
  window.__pushed = data;
  window.__pushCount = (window.__pushCount ?? 0) + 1;
  window.__cloudDoc = JSON.parse(JSON.stringify(data));
}
const __queue = createCloudQueue(pushCloud, { defaultDelay: window.__cloudDelay ?? 0 });
export const pushCloudDebounced = __queue.pushCloudDebounced;
export const flushCloud = __queue.flushCloud;
export async function pushCloudDoc(docId, data) { window.__pushedDoc = { docId, data }; return true; }
export function subscribeCloud(onRemote) {
  window.__onRemote = onRemote;
  return () => { window.__unsubscribed = true; };
}
`;

// クラウド doc の初期値をページに仕込み、偽 cloud.js を配る。
// delay を渡すと debounce キューの遅延をその値にする（既定 0＝既存テストは即時性を保つ）。
async function useFakeCloud(page, cloudDoc, { delay = 0 } = {}) {
  await page.route('**/js/cloud.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: FAKE_CLOUD,
  }));
  await page.addInitScript(({ doc, d }) => {
    try { localStorage.setItem('piano-pet-onboarded', '1'); } catch { /* 無視 */ }
    window.__cloudDoc = doc;
    window.__cloudDelay = d;
  }, { doc: cloudDoc ?? null, d: delay });
}

// localStorage に state を直接仕込む（起動前のローカルデータを作る）。
async function seedLocal(page, state) {
  await page.addInitScript((s) => {
    try { localStorage.setItem('piano-pet', JSON.stringify(s)); } catch { /* 無視 */ }
  }, state);
}

const baseState = (over = {}) => ({
  version: 2,
  pet: {
    name: 'きーちゃん', level: 1, xp: 0, coins: 0,
    equippedItems: [], placedItems: [], itemLayout: {},
    affinity: 0, foodSpent: 0, dailyGoal: 10, catStyle: 'tora',
    childName: '', childAvatar: 'chick',
    ...(over.pet ?? {}),
  },
  inventory: over.inventory ?? [],
  streak: { current: 0, best: 0, lastPracticeDate: null, freezes: 0, ...(over.streak ?? {}) },
  badges: over.badges ?? [],
  sessions: over.sessions ?? [],
  settings: { soundOn: true },
});

const readLocal = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')));

// 同期はアイドル遅延（requestIdleCallback）で走るので、購読が張られるまで待つ。
const waitForSync = (page) => page.waitForFunction(() => typeof window.__onRemote === 'function', null, { timeout: 10000 });

test.describe('クラウド同期の取り込み', () => {
  test('初回同期はローカル優先マージ：ローカルだけが持つ記録が消えない（#142）', async ({ page }) => {
    // クラウドには 01-01 の 4かい だけがある。ローカルには 01-02 の 6かい がある。
    await useFakeCloud(page, {
      pet: { ...baseState().pet }, inventory: [], streak: baseState().streak, badges: [],
      sessions: [{ date: '2026-01-01', totalCount: 4, songs: [{ name: 'A', count: 4 }] }],
    });
    await seedLocal(page, baseState({
      sessions: [{ date: '2026-01-02', totalCount: 6, songs: [{ name: 'B', count: 6 }] }],
    }));

    await page.goto('/');
    await waitForSync(page);

    const st = await readLocal(page);
    const byDate = Object.fromEntries(st.sessions.map((s) => [s.date, s.totalCount]));
    expect(byDate).toEqual({ '2026-01-01': 4, '2026-01-02': 6 });   // union（どちらも消えない）
    expect(st.pet.coins).toBe(10);                                   // sessions から再計算
    // ローカルだけが持っていた記録があるのでクラウドへ確定保存される
    await expect.poll(() => page.evaluate(() => (window.__pushed?.sessions ?? []).length)).toBe(2);
  });

  test('初回同期の同日衝突は keep-larger（合算せず・cloud で上書きもしない・#142）', async ({ page }) => {
    // ローカルを大きい側にする。cloud-wins に退行すると 5 に、合算に退行すると 12 になるので、
    // 7 を期待することで「keep-larger である」ことだけが通る。
    await useFakeCloud(page, {
      pet: { ...baseState().pet }, inventory: [], streak: baseState().streak, badges: [],
      sessions: [{ date: '2026-01-01', totalCount: 5, songs: [{ name: 'A', count: 5 }] }],
    });
    await seedLocal(page, baseState({
      sessions: [{ date: '2026-01-01', totalCount: 7, songs: [{ name: 'A', count: 7 }] }],
    }));

    await page.goto('/');
    await waitForSync(page);

    const st = await readLocal(page);
    expect(st.sessions).toHaveLength(1);
    expect(st.sessions[0].totalCount).toBe(7);   // 5（cloud-wins）でも 12（合算）でもない
  });

  test('復帰時の resync で他端末が置いた置物・座標が消えない（#242）', { tag: '@compat' }, async ({ page }) => {
    // 起動時のクラウドは空。ローカルは cushion を持って配置済み。
    await useFakeCloud(page, null);
    await seedLocal(page, baseState({
      inventory: ['cushion', 'yarnBall'],
      pet: { placedItems: ['cushion'], itemLayout: { cushion: { x_pct: 30, y_pct: 60 } } },
    }));
    await page.goto('/');
    await waitForSync(page);

    // 他端末が yarnBall を置いた状態をクラウドに反映（サスペンド中で onSnapshot は届かない想定）
    await page.evaluate(() => {
      window.__cloudDoc = {
        pet: { ...JSON.parse(localStorage.getItem('piano-pet')).pet, placedItems: ['yarnBall'], itemLayout: { yarnBall: { x_pct: 70, y_pct: 55 } } },
        inventory: ['cushion', 'yarnBall'],
        streak: { current: 0, best: 0, lastPracticeDate: null, freezes: 0 },
        badges: [], sessions: [],
      };
    });

    // タブ復帰 → resyncFromCloud が非破壊 union マージで取り込む
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')).pet.placedItems.length)).toBe(2);

    const st = await readLocal(page);
    expect([...st.pet.placedItems].sort()).toEqual(['cushion', 'yarnBall']);   // 自分の置物が消えない
    expect(st.pet.itemLayout.yarnBall).toEqual({ x_pct: 70, y_pct: 55 });      // 他端末の座標を取り込む
    expect(st.pet.itemLayout.cushion).toEqual({ x_pct: 30, y_pct: 60 });       // 自分の座標は保つ
  });

  test('realtime は cloud-wins：他端末の変更が画面へ反映される', async ({ page }) => {
    await useFakeCloud(page, null);
    await seedLocal(page, baseState());
    await page.goto('/');
    await waitForSync(page);
    await expect(page.locator('#statCoins')).toHaveText('0');

    // 他端末が 12かい 記録した状態を onSnapshot 相当で流し込む
    await page.evaluate(() => window.__onRemote({
      pet: { ...JSON.parse(localStorage.getItem('piano-pet')).pet, coins: 17, xp: 15, level: 1 },
      inventory: [],
      streak: { current: 1, best: 1, lastPracticeDate: '2026-01-01', freezes: 0 },
      badges: ['first_practice'],
      sessions: [{ date: '2026-01-01', totalCount: 12, songs: [{ name: 'A', count: 12 }], coinsEarned: 17, xpEarned: 15 }],
    }));

    await expect(page.locator('#statCoins')).toHaveText('17');
    await expect(page.locator('#statStreak')).toHaveText('1');
    const st = await readLocal(page);
    expect(st.sessions[0].totalCount).toBe(12);
    expect(st.settings.soundOn).toBe(true);   // 端末ローカル設定はクラウドに無いので保持される
  });

  test('クラウドが壊れたデータを返してもアプリは起動して動く（#272）', async ({ page }) => {
    // 認証なし doc（#258 段階2 以前）に第三者が書ける前提での防御。
    await useFakeCloud(page, {
      pet: 'broken', inventory: 'ribbon', streak: [1, 2], badges: 42,
      // #311: 空配列へ潰れる { a: 1 } では「要素の中身」の防御を検証できない。
      // songs 非配列・date 不正の要素を混ぜて、起動経路（mergeSameDaySessions）が
      // 白画面にならないことを確認する。
      sessions: [{ date: '2026-01-01', songs: 5 }, { date: 'garbage', totalCount: 3 }],
    });
    await seedLocal(page, baseState({
      sessions: [{ date: '2026-01-01', totalCount: 3, songs: [{ name: 'A', count: 3 }] }],
    }));

    await page.goto('/');
    await waitForSync(page);

    // 画面が生きている（真っ白にならない）
    await expect(page.locator('#goRecordBtn')).toBeVisible();
    await expect(page.locator('#catStage .cat')).toBeVisible();
    const st = await readLocal(page);
    expect(Array.isArray(st.sessions)).toBe(true);
    expect(Array.isArray(st.inventory)).toBe(true);
    // 記録画面まで到達でき、操作を続けられる
    await page.click('#goRecordBtn');
    await expect(page.locator('#view-record')).toBeVisible();
  });

  test('debounce 保留中に入ったリモートの記録を、遅延 flush が巻き戻さない（#313）', async ({ page }) => {
    await useFakeCloud(page, {
      ...baseState(),
      sessions: [{ date: '2026-01-01', totalCount: 4, songs: [{ name: 'A', count: 4 }] }],
    }, { delay: 1500 });
    await seedLocal(page, baseState({
      sessions: [{ date: '2026-01-01', totalCount: 4, songs: [{ name: 'A', count: 4 }] }],
    }));
    await page.goto('/');
    await waitForSync(page);

    // 端末B：きろく一覧で はなまる をタップ → pushCloudDebounced（1.5秒保留）
    await page.click('.nav-btn[data-nav="history"]');
    await page.locator('#historyList .history-card .praise-stamp').first().click();

    // 保留中に端末Aが 01-02 の記録をクラウドへ（realtime で取り込ませる）
    await page.evaluate(() => window.__onRemote({
      ...window.__cloudDoc,
      sessions: [
        { date: '2026-01-01', totalCount: 4, songs: [{ name: 'A', count: 4 }] },
        { date: '2026-01-02', totalCount: 9, songs: [{ name: 'C', count: 9 }] },
      ],
    }));
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')).sessions.length))
      .toBe(2);

    // 1.5秒後の flush が送る内容に 01-02 が残る（呼び出し時点の古い state を焼き付けていない・#313）
    await expect
      .poll(() => page.evaluate(() => (window.__pushed?.sessions ?? []).map((s) => s.date)), { timeout: 5000 })
      .toContain('2026-01-02');
  });

  // #314: 記録編集の参照は配列 index でなく date（同一性）。編集フォームを開いたまま
  // 同期で sessions が並び替わっても、別の日の記録を壊さない。
  const editSeed = () => baseState({
    sessions: [
      { date: '2026-09-02', totalCount: 7, songs: [{ name: 'Z', count: 7 }] },
      { date: '2026-09-03', totalCount: 5, songs: [{ name: 'Y', count: 5 }] },
    ],
  });

  test('編集フォームを開いたまま sessions が並び替わっても、なおすが正しい記録に当たる（#314）', async ({ page }) => {
    await useFakeCloud(page, { ...editSeed() });
    await seedLocal(page, editSeed());
    await page.goto('/');
    await waitForSync(page);

    await page.click('.nav-btn[data-nav="history"]');
    await page.locator('#historyList .history-card').filter({ hasText: '9月2日' })
      .locator('[data-action="edit-session"]').click();
    await expect(page.locator('#recordDate')).toHaveValue('2026-09-02');

    // 編集中に同期が入り sessions の並びが変わる（realtime は cloud の順をそのまま採る）
    await page.evaluate(() => window.__onRemote({
      ...window.__cloudDoc,
      sessions: [
        { date: '2026-08-20', totalCount: 3, songs: [{ name: 'X', count: 3 }] },
        { date: '2026-09-03', totalCount: 5, songs: [{ name: 'Y', count: 5 }] },
        { date: '2026-09-02', totalCount: 7, songs: [{ name: 'Z', count: 7 }] },
      ],
    }));
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')).sessions.length)).toBe(3);

    await page.click('#stampCard');                       // 7 → 8 かい
    await expect(page.locator('#recordTotal')).toHaveText('8');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-history')).toBeVisible();

    const st = await readLocal(page);
    const byDate = Object.fromEntries(st.sessions.map((s) => [s.date, s.totalCount]));
    // 09-02 だけが 8 に。08-20 / 09-03 は無傷（旧実装は index 参照で 09-03 を壊し 09-02 を二重化）
    expect(byDate).toEqual({ '2026-08-20': 3, '2026-09-03': 5, '2026-09-02': 8 });
  });

  test('編集中の記録がリモートで消えたら、別の記録を壊さず案内を出す（#314）', async ({ page }) => {
    await useFakeCloud(page, { ...editSeed() });
    await seedLocal(page, editSeed());
    await page.goto('/');
    await waitForSync(page);

    await page.click('.nav-btn[data-nav="history"]');
    await page.locator('#historyList .history-card').filter({ hasText: '9月2日' })
      .locator('[data-action="edit-session"]').click();
    await expect(page.locator('#recordDate')).toHaveValue('2026-09-02');

    await page.evaluate(() => window.__onRemote({
      ...window.__cloudDoc,
      sessions: [{ date: '2026-09-03', totalCount: 5, songs: [{ name: 'Y', count: 5 }] }],
    }));
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')).sessions.length)).toBe(1);

    await page.click('#stampCard');
    await page.click('#recordSubmitBtn');

    await expect(page.locator('#recordError')).toBeVisible();
    const st = await readLocal(page);
    expect(st.sessions.map((s) => s.date)).toEqual(['2026-09-03']);
    expect(st.sessions[0].totalCount).toBe(5);            // 残った記録は無傷
  });
});
