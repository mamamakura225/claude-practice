import { test, expect, session, makeState, seed, readLocal, importJson, backupOf, record, ymd, openSettings } from './helpers.js';

// クラウド同期の取り込み経路（#142 初回 / #242 復帰時 resync / realtime）。
// ./js/cloud.js への**リクエストを差し替えて偽モジュールを配り**、app.js の実経路を通す（アプリには手を入れない）。
// 挙動の仕様は docs/data-model.md「取り込み経路は3つあり、規則が同じではない」。
//
// 偽 cloud.js：doc は window.__cloudDoc、realtime は window.__onRemote(doc) で撃つ。debounce のキューは本物
// （既定は遅延 0）。本物と同じく import 時点の doc に束縛し、オフライン中は送らない。送信先はリロードを
// またいで見られるよう sessionStorage の __pushLog に残す。__holdFetch / __holdPush を立てると応答を止める
// （fetch は __releaseFetch() で返す。__pushDelay は #381 だけが使う実時間の遅延）。固定時間の遅延だと、遅い環境で順番が崩れる。
const FAKE_CLOUD = `
import { createCloudQueue } from './cloud-queue.js';
import { getActiveAccountId, cloudDocIdFor } from './account.js';
const DOC_ID = cloudDocIdFor(getActiveAccountId());
const logPush = (target) => {
  const log = JSON.parse(sessionStorage.getItem('__pushLog') ?? '[]');
  sessionStorage.setItem('__pushLog', JSON.stringify([...log, target]));
};
export async function fetchCloud() {
  window.__fetching = true;
  const doc = window.__cloudDoc ?? null;   // サーバが読んだ時点の内容（止めている間の書き込みは載らない）
  if (window.__holdFetch) await new Promise((r) => { window.__releaseFetch = r; });
  window.__fetchDone = true;
  if (window.__fetchFail) return undefined;   // タイムアウト・通信エラー（doc が無い null とは別・#362）
  return doc;
}
export async function pushCloud(data) {
  if (navigator.onLine === false) return false;
  logPush('push:' + DOC_ID);
  window.__pushed = data;
  (window.__pushedAll ??= []).push(JSON.parse(JSON.stringify(data)));
  window.__pushCount = (window.__pushCount ?? 0) + 1;
  window.__cloudDoc = JSON.parse(JSON.stringify(data));
  // 実 Firestore と同じく書き込みはローカルへ即反映し、サーバの ack だけ遅らせる（#374）
  window.__pushStarted = true;
  if (window.__holdPush) await new Promise(() => {});
  if (window.__pushDelay) await new Promise((r) => setTimeout(r, window.__pushDelay));
  return true;
}
const __queue = createCloudQueue(pushCloud, { defaultDelay: window.__cloudDelay ?? 0 });
export const pushCloudDebounced = __queue.pushCloudDebounced;
export const flushCloud = __queue.flushCloud;
export async function pushCloudDoc(docId, data) {
  logPush('pushDoc:' + docId); window.__pushedDoc = { docId, data };
  window.__pushStarted = true;
  if (window.__holdPush) await new Promise(() => {});
  if (window.__pushDelay) await new Promise((r) => setTimeout(r, window.__pushDelay));
  return true;
}
export function subscribeCloud(onRemote) {
  window.__onRemote = onRemote;
  return () => { window.__unsubscribed = true; };
}
`;

// クラウド doc の初期値を仕込み、偽 cloud.js を配る。delay は debounce キューの遅延。
async function useFakeCloud(page, cloudDoc, { delay = 0 } = {}) {
  await page.route('**/js/cloud.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: FAKE_CLOUD,
  }));
  await page.addInitScript(({ doc, d }) => {
    window.__cloudDoc = doc;
    window.__cloudDelay = d;
  }, { doc: cloudDoc ?? null, d: delay });
}

const baseState = ({ pet, ...over } = {}) => makeState({
  version: 2,
  pet: { placedItems: [], itemLayout: {}, affinity: 0, foodSpent: 0, dailyGoal: 10, catStyle: 'tora', childName: '', childAvatar: 'chick', ...pet },
  settings: { soundOn: true },
  ...over,
});
const days = (...list) => baseState({ sessions: list });

// 同期はアイドル遅延（requestIdleCallback）で走るので、購読が張られるまで待つ。
const waitForSync = (page) => page.waitForFunction(() => typeof window.__onRemote === 'function', null, { timeout: 10000 });

test.describe('クラウド同期の取り込み', () => {
  test('初回同期はローカル優先マージ：片側だけの記録は消えず、同日は回数の多い方（#142）', async ({ page }) => {
    await useFakeCloud(page, days(session('2026-01-01', 4, 'A'), session('2026-01-03', 5, 'A')));
    await seed(page, days(session('2026-01-02', 6, 'B'), session('2026-01-03', 7, 'A')));
    await page.goto('/');
    await waitForSync(page);

    const st = await readLocal(page);
    // 01-03 は cloud-wins なら 5、合算なら 12 になる
    expect(Object.fromEntries(st.sessions.map((s) => [s.date, s.totalCount])))
      .toEqual({ '2026-01-01': 4, '2026-01-02': 6, '2026-01-03': 7 });
    expect(st.pet.coins).toBe(4 + 6 + 7 + 10);   // sessions から再計算（3日連続の +10）
    // ローカルだけが持っていた記録があるのでクラウドへ確定保存される
    await expect.poll(() => page.evaluate(() => (window.__pushed?.sessions ?? []).length)).toBe(3);
  });

  test('復帰時の resync で他端末が置いた置物・座標が消えない（#242）', { tag: '@compat' }, async ({ page }) => {
    // 起動時のクラウドは空。ローカルは cushion を持って配置済み。
    await useFakeCloud(page, null);
    await seed(page, baseState({
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
    await seed(page, baseState());
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
    await seed(page, days(session('2026-01-01', 3, 'A')));

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
    await useFakeCloud(page, days(session('2026-01-01', 4, 'A')), { delay: 1500 });
    await seed(page, days(session('2026-01-01', 4, 'A')));
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
    await expect.poll(async () => (await readLocal(page)).sessions.length).toBe(2);

    // 1.5秒後の flush が送る内容に 01-02 が残る（呼び出し時点の古い state を焼き付けていない・#313）
    await expect
      .poll(() => page.evaluate(() => (window.__pushed?.sessions ?? []).map((s) => s.date)), { timeout: 5000 })
      .toContain('2026-01-02');
  });

  // #314: 記録編集の参照は配列 index でなく date（同一性）。編集フォームを開いたまま
  // 同期で sessions が並び替わっても、別の日の記録を壊さない。
  const editSeed = () => days(session('2026-09-02', 7, 'Z'), session('2026-09-03', 5, 'Y'));

  test('編集フォームを開いたまま sessions が並び替わっても、なおすが正しい記録に当たる（#314）', async ({ page }) => {
    await useFakeCloud(page, editSeed());
    await seed(page, editSeed());
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
    await expect.poll(async () => (await readLocal(page)).sessions.length).toBe(3);

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
    await useFakeCloud(page, editSeed());
    await seed(page, editSeed());
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
    await expect.poll(async () => (await readLocal(page)).sessions.length).toBe(1);

    await page.click('#stampCard');
    await page.click('#recordSubmitBtn');

    await expect(page.locator('#recordError')).toBeVisible();
    const st = await readLocal(page);
    expect(st.sessions.map((s) => s.date)).toEqual(['2026-09-03']);
    expect(st.sessions[0].totalCount).toBe(5);            // 残った記録は無傷

    // もう一度送っても新規記録にならず、もどるは きろく へ（#401）
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#recordError')).toBeVisible();
    expect((await readLocal(page)).sessions.map((s) => s.date)).toEqual(['2026-09-03']);
    await page.click('#recordBackBtn');
    await expect(page.locator('#view-history')).toBeVisible();
  });

  // #319: 端末Aで削除 → 端末Bの古いスナップショットが降ってきても記録は復活しない
  test('削除した記録は、古い doc が realtime で降ってきても復活しない（tombstone）', async ({ page }) => {
    await useFakeCloud(page, days(session('2026-09-01', 4, 'A'), session('2026-09-02', 6, 'B')));
    await seed(page, days(session('2026-09-01', 4, 'A'), session('2026-09-02', 6, 'B')));
    await page.goto('/');
    await waitForSync(page);

    // 端末A：9/01 を削除
    await page.click('.nav-btn[data-nav="history"]');
    page.once('dialog', (d) => d.accept());
    await page.locator('#historyList .history-card').filter({ hasText: '9月1日' })
      .locator('[data-action="delete-session"]').click();
    await expect(page.locator('#undoToast')).toBeVisible();
    await page.click('.nav-btn[data-nav="home"]');   // 画面を移ると確定（#398）
    await expect.poll(async () => (await readLocal(page)).sessions.length).toBe(1);

    // 端末B（サスペンド中で削除を受けていない）の古いスナップショットが降ってくる
    await page.evaluate(() => window.__onRemote({
      pet: JSON.parse(localStorage.getItem('piano-pet')).pet,
      inventory: [], streak: { current: 0, best: 0, lastPracticeDate: null, freezes: 0 }, badges: [],
      deletedDates: [],
      sessions: [
        { date: '2026-09-01', totalCount: 4, songs: [{ name: 'A', count: 4 }] },
        { date: '2026-09-02', totalCount: 6, songs: [{ name: 'B', count: 6 }] },
      ],
    }));

    const st = await readLocal(page);
    expect(st.sessions.map((s) => s.date)).toEqual(['2026-09-02']);
    expect(st.deletedDates).toContain('2026-09-01');
  });

  // #358-1: 「なおす」で日付を動かしたら、元の日付は削除と同じ扱い（墓標）にする
  test('なおすで日付を変えた記録は、古い doc との union で元の日付に復活しない（#358）', async ({ page }) => {
    await useFakeCloud(page, editSeed());
    await seed(page, editSeed());
    await page.goto('/');
    await waitForSync(page);

    await page.click('.nav-btn[data-nav="history"]');
    await page.locator('#historyList .history-card').filter({ hasText: '9月2日' })
      .locator('[data-action="edit-session"]').click();
    await page.fill('#recordDate', '2026-09-01');
    await page.click('#recordSubmitBtn');
    await expect(page.locator('#view-history')).toBeVisible();

    // 端末B（編集を受けていない古いコピー）の doc を復帰時 resync で取り込む
    await page.evaluate(() => {
      window.__cloudDoc = {
        pet: JSON.parse(localStorage.getItem('piano-pet')).pet,
        inventory: [], streak: { current: 0, best: 0, lastPracticeDate: null, freezes: 0 }, badges: [],
        deletedDates: [],
        sessions: [
          { date: '2026-09-02', totalCount: 7, songs: [{ name: 'Z', count: 7 }] },
          { date: '2026-09-03', totalCount: 5, songs: [{ name: 'Y', count: 5 }] },
        ],
      };
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => page.evaluate(() => (window.__cloudDoc.deletedDates ?? []).length)).toBe(1);

    const st = await readLocal(page);
    expect(Object.fromEntries(st.sessions.map((s) => [s.date, s.totalCount])))
      .toEqual({ '2026-09-01': 7, '2026-09-03': 5 });   // 09-02 が戻ると 7 が二重計上になる
    expect(st.deletedDates).toEqual(['2026-09-02']);
  });

  // #358-2: オフライン中は onSnapshot が届かない。復帰時に古い state で全置換すると他端末の記録が消える
  test('オンライン復帰で、オフライン中に他端末が書いた記録を上書きしない（#358）', async ({ page, context }) => {
    const local = days(session('2026-09-01', 4, 'A'));
    await useFakeCloud(page, local);
    await seed(page, local);
    await page.goto('/');
    await waitForSync(page);

    await context.setOffline(true);
    // 端末Bがクラウドへ 09-02 を記録（この端末には届かない）
    await page.evaluate(() => {
      window.__cloudDoc = {
        ...window.__cloudDoc,
        sessions: [
          { date: '2026-09-02', totalCount: 6, songs: [{ name: 'B', count: 6 }] },
          ...window.__cloudDoc.sessions,
        ],
      };
    });
    await context.setOffline(false);

    await expect.poll(async () => (await readLocal(page)).sessions.length).toBe(2);
    const cloudDates = await page.evaluate(() => window.__cloudDoc.sessions.map((s) => s.date).sort());
    expect(cloudDates).toEqual(['2026-09-01', '2026-09-02']);   // 旧実装は 09-01 だけで全置換
  });

  test('オフライン中の記録は、復帰前後に届いたスナップショットの cloud-wins で消えない（#358）', async ({ page, context }) => {
    const local = days(session('2026-09-01', 4, 'A'));
    await useFakeCloud(page, local);
    await seed(page, local);
    await page.goto('/');
    await waitForSync(page);

    await context.setOffline(true);
    const today = await record3(page);

    // オフライン中（または再接続直後で resync より前）にスナップショット（端末Bの 09-02 入り・この端末の記録は無い）が届く
    await page.evaluate(() => window.__onRemote({
      ...window.__cloudDoc,
      sessions: [
        { date: '2026-09-02', totalCount: 6, songs: [{ name: 'B', count: 6 }] },
        ...window.__cloudDoc.sessions,
      ],
    }));
    await context.setOffline(false);

    await expect.poll(() => page.evaluate(() => (window.__cloudDoc.sessions ?? []).map((s) => s.date).sort()))
      .toEqual(['2026-09-01', '2026-09-02', today].sort());
    const st = await readLocal(page);
    expect(st.sessions.map((s) => s.date).sort()).toEqual(['2026-09-01', '2026-09-02', today].sort());

    // 復帰して送り終えたら印は下り、平常の cloud-wins に戻る（印が残ると union のままで 09-02 が消えない）
    await page.evaluate(() => window.__onRemote({
      ...window.__cloudDoc,
      sessions: window.__cloudDoc.sessions.filter((s) => s.date !== '2026-09-02'),
    }));
    await expect.poll(async () => (await readLocal(page)).sessions.some((s) => s.date === '2026-09-02')).toBe(false);
  });

  // #358-3: cloud.js の DATA_DOC は import 時点で固定。がぞくコード入りの復元を pushCloud すると
  // 切替前（旧・推測可能な pianopet/data）へ書き戻してしまう
  test('がぞくコード入りバックアップの復元は、旧 doc でなくコードの doc へ書く（#358）', async ({ page }) => {
    await useFakeCloud(page, baseState());
    await seed(page, baseState());
    await page.goto('/');
    await waitForSync(page);
    await page.evaluate(() => sessionStorage.removeItem('__pushLog'));

    const backup = backupOf(baseState({ pet: { coins: 321 } }), { cloudDocId: 'pp-family-code-1234' });
    page.on('dialog', (d) => d.accept());
    await importJson(page, backup);

    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet:cloud-ids') ?? '{}').data))
      .toBe('pp-family-code-1234');
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('__pushLog') ?? '[]')), { timeout: 10000 })
      .toContain('pushDoc:pp-family-code-1234');
    const log = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__pushLog') ?? '[]'));
    expect(log).not.toContain('push:data');   // 旧 doc へは一度も書かない
  });

  // #362: fetchCloud のタイムアウトを「doc が無い」と取り違えて、ローカルで全置換しない
  test('初回の取得に失敗しても、他端末の記録がある doc をローカルで上書きしない（#362）', async ({ page }) => {
    const local = days(session('2026-09-01', 4, 'A'));
    await useFakeCloud(page, days(session('2026-09-02', 6, 'B')));
    await seed(page, local);
    await page.addInitScript(() => { window.__fetchFail = true; });
    await page.goto('/');
    await waitForSync(page);

    // 取得に失敗した起動では push しない（旧実装は hasLocalData で 09-01 だけの state を全置換）
    expect(await page.evaluate(() => window.__cloudDoc.sessions.map((s) => s.date))).toEqual(['2026-09-02']);

    // 最初に届いたスナップショットは cloud-wins でなく union で取り込み、両方を残して送る
    await page.evaluate(() => window.__onRemote(window.__cloudDoc));
    await expect.poll(() => page.evaluate(() => window.__cloudDoc.sessions.map((s) => s.date).sort()))
      .toEqual(['2026-09-01', '2026-09-02']);
    const st = await readLocal(page);
    expect(st.sessions.map((s) => s.date).sort()).toEqual(['2026-09-01', '2026-09-02']);
  });

  // #374: 初回の取り込みが済むまで（取得待ち・取得失敗後）のユーザー操作で、ローカルだけの state を全置換 push しない
  const record3 = async (page) => {
    await record(page, 3, { song: 'C' });
    return (await readLocal(page)).sessions.find((x) => x.date !== '2026-09-01').date;
  };
  const otherDoc = () => days(session('2026-09-02', 6, 'B'));
  const localSeed = () => days(session('2026-09-01', 4, 'A'));
  const cloudDates = (page) => page.evaluate(() => (window.__cloudDoc?.sessions ?? []).map((x) => x.date).sort());

  test('初回の取得を待つ間に記録しても、他端末の記録を上書きしない（#374）', async ({ page }) => {
    await useFakeCloud(page, otherDoc());
    await seed(page, localSeed());
    await page.addInitScript(() => { window.__holdFetch = true; });
    await page.goto('/');
    await page.waitForFunction(() => window.__fetching === true, null, { timeout: 10000 });
    const today = await record3(page);
    expect(await cloudDates(page)).toEqual(['2026-09-02']);   // 取り込み前は送らない
    await page.evaluate(() => window.__releaseFetch());
    await waitForSync(page);
    await expect.poll(() => cloudDates(page)).toEqual(['2026-09-01', '2026-09-02', today].sort());
  });

  test('初回の取得に失敗したあと記録しても、最初のスナップショットまで送らない（#374）', async ({ page }) => {
    await useFakeCloud(page, otherDoc());
    await seed(page, localSeed());
    await page.addInitScript(() => { window.__fetchFail = true; });
    await page.goto('/');
    await waitForSync(page);
    const today = await record3(page);
    expect(await cloudDates(page)).toEqual(['2026-09-02']);
    await page.evaluate(() => window.__onRemote(window.__cloudDoc));
    await expect.poll(() => cloudDates(page)).toEqual(['2026-09-01', '2026-09-02', today].sort());
  });

  test('doc が無いのに取得に失敗した端末は、次の resync で初回移行する（#374）', async ({ page }) => {
    await useFakeCloud(page, null);
    await seed(page, localSeed());
    await page.addInitScript(() => { window.__fetchFail = true; });
    await page.goto('/');
    await waitForSync(page);
    const today = await record3(page);
    expect(await page.evaluate(() => window.__cloudDoc ?? null)).toBeNull();   // 取れないうちは送らない
    await page.evaluate(() => { window.__fetchFail = false; document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => cloudDates(page)).toEqual(['2026-09-01', today].sort());
  });

  test('初回移行の ack を待つ間に記録しても、最初のスナップショットで消えない（#374）', async ({ page }) => {
    await useFakeCloud(page, null);   // doc が無い＝ローカルを初回移行する
    await seed(page, localSeed());
    await page.addInitScript(() => { window.__holdPush = true; });
    await page.goto('/');
    await page.waitForFunction(() => window.__pushStarted === true, null, { timeout: 10000 });
    const today = await record3(page);
    await waitForSync(page);
    // 購読開始後の最初のスナップショット（ローカル即時反映ぶんを含む doc）
    await page.evaluate(() => window.__onRemote(window.__cloudDoc));
    const st = await readLocal(page);
    expect(st.sessions.map((x) => x.date).sort()).toEqual(['2026-09-01', today].sort());
  });

  // #378: 復元の push（ack 待ち）の間に、先に走り出していた resync が古いクラウドとの union を送らない
  test('復元の push を待つ間に resync が終わっても、古い記録を混ぜて送らない（#378）', async ({ page }) => {
    await useFakeCloud(page, days(...otherDoc().sessions, ...localSeed().sessions));
    await seed(page, localSeed());
    await page.goto('/');
    await waitForSync(page);

    // 復帰時 resync の取得が走り出す（サーバは 09-01・09-02 を返すが、まだ届かない）
    await page.evaluate(() => {
      window.__holdFetch = true; window.__fetchDone = false; window.__holdPush = true; window.__pushCount = 0;
      window.__pushStarted = false;   // 以降は「復元の push が始まった」の印
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const backup = backupOf(days(session('2026-09-05', 2, 'Z')));
    page.on('dialog', (d) => d.accept());
    await importJson(page, backup);
    await page.waitForFunction(() => window.__pushStarted === true, null, { timeout: 10000 });
    await page.evaluate(() => window.__releaseFetch());
    await page.waitForFunction(() => window.__fetchDone === true);

    // 復元の1回だけ。旧実装は resync が union（09-01・09-02・09-05）を追い送りする
    expect(await page.evaluate(() => window.__pushCount)).toBe(1);
    expect(await cloudDates(page)).toEqual(['2026-09-05']);
  });

  test('起動直後の初回取得が復元中に返っても、購読を張り直して古い doc で上書きしない（#378）', async ({ page }) => {
    await useFakeCloud(page, days(...otherDoc().sessions, ...localSeed().sessions));
    await seed(page, localSeed());
    await page.addInitScript(() => { window.__holdFetch = true; window.__holdPush = true; });
    await page.goto('/');
    await page.waitForFunction(() => window.__fetching === true, null, { timeout: 10000 });
    const backup = backupOf(days(session('2026-09-05', 2, 'Z')));
    page.on('dialog', (d) => d.accept());
    await importJson(page, backup);
    await page.waitForFunction(() => window.__pushStarted === true, null, { timeout: 10000 });
    await page.evaluate(() => window.__releaseFetch());
    await page.waitForFunction(() => window.__fetchDone === true);

    expect(await page.evaluate(() => typeof window.__onRemote)).not.toBe('function');   // 購読を張り直さない
    const st = await readLocal(page);
    expect(st.sessions.map((x) => x.date)).toEqual(['2026-09-05']);                     // 復元結果のまま
  });

  // #381: onLine なのに不通の回線では setDoc が解決しない。上書き系の push を待ち続けてリロードが止まらない
  for (const kind of ['しょきか', 'ふくげん', 'ふくげん（がぞくコード付き）']) {
    test(`push が返らない回線でも ${kind} は上限時間内にリロードする（#381）`, async ({ page }) => {
      await useFakeCloud(page, { ...baseState() });
      await seed(page, localSeed());
      await page.goto('/');
      await waitForSync(page);
      await page.evaluate(() => { window.__pushDelay = 60000; });   // ack が返らない
      page.on('dialog', (d) => d.accept());
      const reloaded = page.waitForEvent('load', { timeout: 14000 });   // 見切りは10秒
      if (kind === 'しょきか') {
        await page.click('#settingsToggle');
        await expect(page.locator('#settingsGate')).toBeVisible();
        const a = Number(await page.textContent('#gateA'));
        const b = Number(await page.textContent('#gateB'));
        await page.fill('#gateAnswer', String(a * b));
        await page.click('#gateSubmit');
        await expect(page.locator('#settingsMenu')).toBeVisible();
        await page.click('#resetBtn');
      } else {
        const code = kind.includes('がぞく') ? { cloudDocId: 'pp-family-code-1234' } : {};
        const backup = JSON.stringify({ app: 'piano-pet', schemaVersion: 2, exportedAt: '2026-10-02T00:00:00.000Z', ...code, state: baseState() });
        await page.setInputFiles('#importFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
      }
      await reloaded;   // 旧実装は ack を待ち続けて 60 秒止まる
    });
  }

  // #384: 上書きがクラウドへ届いたかどうかを、次の起動で親に伝える
  const UNSENT = 'まだ とどいていない';
  async function resetAndReload(page, { lost }) {
    const messages = [];
    page.on('dialog', (d) => { messages.push(d.message()); d.accept(); });
    await page.clock.install();
    await useFakeCloud(page, { ...baseState() });
    await seed(page, localSeed());
    await page.goto('/');
    await waitForSync(page);
    await openSettings(page);
    await page.evaluate((v) => { window.__pushStarted = false; window.__holdPush = v; }, lost);
    const reloaded = page.waitForEvent('load');
    await page.click('#resetBtn');
    if (lost) {
      await page.waitForFunction(() => window.__pushStarted);
      await page.clock.fastForward(11000);   // 見切りは10秒
    }
    await reloaded;
    return messages;
  }

  test('初期化がクラウドへ届かなかったら、次の起動で一度だけ伝える（#384）', async ({ page }) => {
    const messages = await resetAndReload(page, { lost: true });
    await expect.poll(() => messages.some((m) => m.includes(UNSENT))).toBe(true);
    const before = messages.length;
    await page.reload();
    await waitForSync(page);
    expect(messages.slice(before)).toEqual([]);
  });

  test('初期化がクラウドへ届いたら、何も伝えない（#384）', async ({ page }) => {
    const messages = await resetAndReload(page, { lost: false });
    await waitForSync(page);
    expect(messages.some((m) => m.includes(UNSENT))).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('piano-pet:overwrite-unsent'))).toBeNull();
  });

  for (const [btn, label] of [['#cloudMigrateBtn', 'うつす'], ['#cloudClearLegacyBtn', 'からにする']]) {
    test(`ack が返らない回線でも「${label}」は上限時間内に失敗を伝える（#384）`, async ({ page }) => {
      const migrated = btn === '#cloudClearLegacyBtn';
      await page.clock.install();
      await useFakeCloud(page, { ...baseState() });
      await seed(page, localSeed(), migrated ? { 'piano-pet:cloud-ids': JSON.stringify({ data: 'pp-family-code-1234' }) } : {});
      page.on('dialog', (d) => d.accept());
      await page.goto('/');
      await waitForSync(page);
      await openSettings(page);
      await page.evaluate(() => { window.__pushStarted = false; window.__holdPush = true; });
      await page.click(btn);
      await page.waitForFunction(() => window.__pushStarted);
      await page.clock.fastForward(11000);
      await expect(page.locator('#cloudStatus')).toHaveClass(/settings-menu__note--error/);
      if (!migrated) expect(await page.evaluate(() => localStorage.getItem('piano-pet:cloud-ids'))).toBeNull();   // コードは保存しない
    });
  }

  // 日付をまたいで復帰すると「きょう」になったレッスン日を取りこむ（#428）。取り込み前の state で送ると #242 の再来
  async function comeBackNextDay(page, { fetchFail = false } = {}) {
    const noon = new Date(); noon.setHours(12, 0, 0, 0);
    await page.clock.install({ time: noon });
    await useFakeCloud(page, null, { delay: 50 });
    await seed(page, baseState({ pet: { lessonDates: [ymd(-1)] }, sessions: [session('2026-01-01', 4, 'A')] }));
    await page.goto('/');
    await waitForSync(page);
    await expect.poll(() => page.evaluate(() => window.__cloudDoc?.sessions?.length)).toBe(1);
    // 休んでいる間に、他の端末が記録した
    await page.evaluate(([fail, other]) => {
      window.__pushedAll = [];
      window.__cloudDoc.sessions.push(other);
      window.__holdFetch = true;
      window.__fetchDone = false;
      window.__fetchFail = fail;
    }, [fetchFail, session('2026-01-02', 6, 'B')]);
    await page.clock.setSystemTime(noon.getTime() + 86400000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(300);   // 送信の待ち（50ms）より取得が遅い
    await page.evaluate(() => { window.__holdFetch = false; window.__releaseFetch(); });
    await page.waitForFunction(() => window.__fetchDone);
    await page.waitForTimeout(300);
  }

  test('日付をまたいで復帰したとき、レッスン日の取りこみは最新を取り込んでから送る（#428）', async ({ page }) => {
    await comeBackNextDay(page);
    const pushed = await page.evaluate(() => window.__pushedAll.map((d) => ({ n: d.sessions.length, coins: d.pet.coins })));
    expect(pushed.length).toBeGreaterThan(0);
    expect(pushed.map((p) => p.n)).not.toContain(1);      // 取り込む前の（1件しかない）state を送っていない
    expect(pushed.at(-1).coins).toBe(4 + 6 + 10);          // 他の端末の分もレッスンの分も入る
    await expect(page.locator('#statCoins')).toHaveText('20');
  });

  test('復帰時に取れなければ、レッスン日の取りこみは送らずに次の再同期まで待つ（#428）', async ({ page }) => {
    await comeBackNextDay(page, { fetchFail: true });
    expect(await page.evaluate(() => window.__pushedAll.length)).toBe(0);
    await page.evaluate(() => { window.__fetchFail = false; document.dispatchEvent(new Event('visibilitychange')); });
    await expect(page.locator('#statCoins')).toHaveText('20');
  });

  test('キー順だけ違う同じ内容のクラウドでは、起動時に送らない（#428）', async ({ page }) => {
    const local = baseState({
      pet: { xp: 4, coins: 4 }, badges: ['first_practice'],
      streak: { current: 1, best: 1, lastPracticeDate: '2026-01-01' },
      sessions: [{ ...session('2026-01-01', 4, 'A'), coinsEarned: 4, xpEarned: 4, bonusCoins: 0, praise: null, tempo: null }],
    });
    const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
    const { pet, inventory, streak, badges, sessions } = local;
    await useFakeCloud(page, sorted({ pet, inventory, streak, badges, sessions, deletedDates: [] }));   // Firestore はキーをソートして返す
    await seed(page, local);
    await page.goto('/');
    await waitForSync(page);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__pushCount ?? 0)).toBe(0);
  });
});
