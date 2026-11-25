import { test as base, expect } from '@playwright/test';

export { expect };

/**
 * 全 spec 共通の土台。
 * - Firebase を必ず遮断する（本番の保存先を読み書きせず、シードがクラウドの値で上書きされない）
 * - 初回オンボーディングは「見た」ことにして始める（確かめる spec だけ test.use({ onboarded: false })）
 */
export const test = base.extend({
  onboarded: [true, { option: true }],
  page: async ({ page, context, onboarded }, use) => {
    await context.route(/gstatic\.com\/firebasejs|(firestore|firebase|identitytoolkit)\.googleapis\.com/, (route) => route.abort());
    if (onboarded) await page.addInitScript(() => localStorage.setItem('piano-pet-onboarded', '1'));
    await use(page);
  },
});

/** back 日前の YYYY-MM-DD（負なら先の日）。 */
export function ymd(back = 0) {
  const d = new Date();
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 記録1件。day は何日前か（数値）か YYYY-MM-DD。 */
export const session = (day, count = 3, name = 'きらきらぼし') => ({
  date: typeof day === 'number' ? ymd(day) : day, songs: [{ name, count }], totalCount: count,
});

/** 保存データの土台。pet / streak は上書き分だけ渡す。 */
export const makeState = ({ pet, streak, ...rest } = {}) => ({
  pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [], ...pet },
  inventory: [],
  streak: { current: 0, best: 0, lastPracticeDate: null, freezes: 0, ...streak },
  badges: [],
  sessions: [],
  ...rest,
});

/** 起動前の保存データ。最初の読み込みでだけ書く（reload で書き直すと、保存結果を確かめられない）。 */
export async function seed(page, state, extra = {}) {
  await page.addInitScript(([s, ex]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('piano-pet', JSON.stringify(s));
    for (const [k, v] of Object.entries(ex)) localStorage.setItem(k, v);
  }, [state, extra]);
}

export const readLocal = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('piano-pet')));

/**
 * 乱数を固定する。0＝抽選は全部当たり（おまけ・記録クリップ・威嚇）、0.999＝全部外れ。
 * 1 は定義域外で、cat-video.js のシャッフルを壊すので使わない。
 */
export const fixRandom = (page, value) => page.addInitScript((v) => { Math.random = () => v; }, value);

export async function gotoHome(page) {
  await page.goto('/');
  await expect(page.locator('#goRecordBtn')).toBeVisible({ timeout: 10000 });
}

/** ホームで ⚙️ を押し、親ゲート（かけ算）を解いてメニューを開く。 */
export async function openSettings(page) {
  await page.click('#settingsToggle');
  await solveGate(page);
}

export async function solveGate(page) {
  await expect(page.locator('#settingsGate')).toBeVisible();   // 出題は遅延読込のあとに入る
  const a = Number(await page.locator('#gateA').textContent());
  const b = Number(await page.locator('#gateB').textContent());
  await page.fill('#gateAnswer', String(a * b));
  await page.click('#gateSubmit');
  await expect(page.locator('#settingsMenu')).toBeVisible();
}

export const closeSettings = (page) => page.click('#settingsMenu [data-action="close-settings"]');

/** 確認ダイアログを通さず、保存ファイルを読み込ませる。 */
export const importJson = (page, obj) => page.setInputFiles('#importFile', {
  name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj)),
});

export const backupOf = (state, extra = {}) => ({
  app: 'piano-pet', schemaVersion: 2, exportedAt: '2026-10-01T00:00:00.000Z', ...extra, state,
});

export async function addSong(page, name) {
  await page.fill('#newSongInput', name);
  await page.click('#addSongBtn');
}

/** ホームから n 回ぶん記録してホームへ戻る。song: null なら選択済みの曲のまま押す。 */
export async function record(page, n, { song = 'きらきらぼし' } = {}) {
  await page.click('#goRecordBtn');
  await expect(page.locator('#view-record')).toBeVisible();
  if (song) await addSong(page, song);
  for (let i = 0; i < n; i += 1) await page.click('#stampCard');
  await page.click('#recordSubmitBtn');
  await expect(page.locator('#view-home')).toBeVisible();
}

/** 記録後のコインのポップアップ（全画面で操作を受ける）をタップで閉じる。遅い環境で先に閉じていたらそのまま進む。 */
export async function skipCoinPopup(page) {
  const popup = page.locator('#coinPopup');
  await popup.click({ timeout: 3000 }).catch(() => {});
  await expect(popup).toBeHidden();
}
