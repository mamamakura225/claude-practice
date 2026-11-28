// ===== クラウド同期（Firestore）（#439 で app.js から分けた） =====
// ローカルで即描画したあと、クラウドと突き合わせる。SDK は CDN 読み込みなので
// 動的 import で取り込み、失敗（オフライン等）してもローカル動作を妨げない。
// 描画・保存・レッスン日の取りこみは app.js 側の仕事なので startCloudSync で受け取る。
import { state } from './state.js';
import { cloudFields, mergeCloud, mergeCloudInitial, cloudDigest, normalizeState } from './storage.js';
import { recomputeState, checkBadges } from './game.js';
import { spentTotal } from './shop.js';

// クラウド同期モジュール（./cloud.js）。動的 import が成功したら入る。
// オフライン等で読み込めない場合は null のまま＝localStorage だけで動作する。
let cloud = null;
export const getCloud = () => cloud;

// onSnapshot 購読の解除ハンドル。データ復元時に一時解除して、古いスナップショットによる
// 巻き戻し（インポート直後に他端末の旧データがエコーで降ってくる競合）を防ぐ（#140）。
let cloudUnsub = null;

// オフライン中の未送信変更の印＝立っている間の realtime は union（#358）
let offlineDirty = false;

// app.js から受け取る { adopt(next), settled() }（startCloudSync）
let hooks = null;

// 取り込み前・印の間は送らない（#374・data-model.md）
const cloudPayload = () => (offlineDirty || overwriting ? null : cloudFields(state));
export function queueCloudPush() {
  if (!cloud || !initialSyncDone) return;
  if (navigator.onLine === false) offlineDirty = true;
  if (!offlineDirty) cloud.pushCloudDebounced(cloudPayload);
}

// 取り消せる操作（レッスン日の解除）は、猶予が終わるまでクラウドへ送らない（#398）。先に届くと
// 取り消しても他端末の union（inventory・lessonRemoved）で買い直し／消し直しになる（削除の保留と同じ理由）。
export function holdCloudPush(delay) {
  if (!cloud || !initialSyncDone || offlineDirty) return;
  cloud.pushCloudDebounced(cloudPayload, delay);
}

export const flushCloud = () => cloud?.flushCloud();

let overwriting = false;   // 上書き中は、届いたクラウドの内容も保留中の送信も無視する（#378）
// 不通の回線では setDoc が解決しないので10秒で見切る。時間内に送れたら true（#381 #384・data-model.md）
export const withinLimit = (push) => Promise.race([
  push.then((ok) => ok === true, () => false),
  new Promise((r) => setTimeout(() => r(false), 10000)),
]);
const UNSENT_KEY = 'piano-pet:overwrite-unsent';

// 上書きの push。届かなかったら印を残し、次の起動で親に伝える（#384）
export async function pushForOverwrite(docId = null) {
  const data = cloudFields(state);
  const ok = cloud && navigator.onLine !== false
    && await withinLimit(docId ? cloud.pushCloudDoc(docId, data) : cloud.pushCloud(data));
  if (!ok) try { localStorage.setItem(UNSENT_KEY, '1'); } catch { /* 無視 */ }
}

// 前回の上書きが届かなかった印を読んで消す（一度だけ伝えるため）
export function takeUnsentMark() {
  try {
    if (!localStorage.getItem(UNSENT_KEY)) return false;
    localStorage.removeItem(UNSENT_KEY);
    return true;
  } catch { return false; }
}

export function stopCloudForOverwrite() {
  overwriting = true;
  clearTimeout(retryTimer);
  if (cloudUnsub) {
    try { cloudUnsub(); } catch { /* 解除失敗は無視 */ }
    cloudUnsub = null;
  }
}

// クラウドのデータを現在の state に取り込んで再描画する。
// 自分の書き込みのエコーなど「実質変化なし」のときは再描画をスキップする。
function applyRemoteState(cloudData) {
  if (offlineDirty) {
    reconcileInitialCloud(cloudData);
    if (navigator.onLine !== false) offlineDirty = false;
    return;
  }
  const merged = mergeCloud(state, cloudData);
  merged.badges = checkBadges(merged);   // 版の古い端末は新しいバッジを欠いて送ってくる
  if (cloudDigest(merged) === cloudDigest(state)) return;
  hooks.adopt(merged);
}

// ローカルに引き継ぐ価値のあるデータがあるか（初回クラウド移行の判定用）。
function hasLocalData(s) {
  return s.sessions.length > 0 || s.badges.length > 0 || s.inventory.length > 0
    || s.pet.coins > 0 || s.pet.xp > 0 || s.pet.level > 1;
}

let cloudSynced = false;
// 初回の fetch → reconcile が完了したか（#313）。cloudSynced は import 成功で立つが、
// その後の fetchCloud（最大5秒）を待つ間に 'online' が発火すると、マージ前のローカル state で
// setDoc 全置換してしまう。この間の push は initialSyncDone で抑える。
let initialSyncDone = false;
async function initCloudSync() {
  if (cloudSynced) return;
  try {
    cloud = await import('./cloud.js');     // CDN 取得に失敗すると reject
  } catch (err) {
    cloud = null;
    console.warn('クラウド同期は利用できません（オフライン等）。ローカルのみで動作します。', err);
    return;                                 // 'online' 復帰時に再試行
  }
  cloudSynced = true;
  const cloudData = await cloud.fetchCloud();
  if (overwriting) return;
  if (cloudData) {
    reconcileInitialCloud(cloudData);       // 初回はローカル優先マージ（起動直後の記録を消さない）
  } else if (cloudData === null && hasLocalData(state)) {
    cloud.pushCloud(cloudFields(state));    // 初回移行（doc が無いときだけ）。ack は待たない（#374）
  } else if (cloudData === undefined) {
    offlineDirty = true;                    // 取れなかった：最初のスナップショットを union で取り込む（#362）
    scheduleRetry();
  }
  initialSyncDone = true;
  cloudUnsub = cloud.subscribeCloud(applyRemoteState);   // 以降は他端末の変更をリアルタイム反映（ハンドルは復元時の解除用に保持）
}

// 初回 fetchCloud の取り込み（#142）。realtime onSnapshot の cloud-wins（applyRemoteState）と違い、
// 起動直後（idle 同期完了前）にローカルで記録した内容を cloud で上書きしないよう、
// mergeCloudInitial でフィールドごとにローカル優先マージし、sessions から全導出値を再計算する。
function reconcileInitialCloud(cloudData) {
  if (overwriting) return;
  const merged = mergeCloudInitial(state, cloudData);
  const reconciled = recomputeState(merged, spentTotal(merged));
  const reconciledCloud = cloudDigest(reconciled);

  if (reconciledCloud !== cloudDigest(state)) hooks.adopt(reconciled);
  // ローカルだけが持っていた記録（起動直後に記録した分など）でクラウドが古ければ確定保存する。
  if (reconciledCloud !== cloudDigest(normalizeState(cloudData))) {
    cloud?.pushCloud(cloudFields(state));
  }
}

// 復帰時の再同期（#242）。iOS PWA 等はサスペンド中 onSnapshot が届かないため、復帰直後の
// 古い in-memory state のまま操作すると、その古い pet が placedItems ごとクラウドを丸ごと
// 上書き（pushCloud=setDoc 置換）し、他端末で配置した置物が消える。復帰時に最新クラウドを
// fetch → 非破壊 union マージ（reconcileInitialCloud＝mergeCloudInitial 経路）で取り込み、
// 以後の push が最新の配置込みになるようにする。差分が無ければ getDoc 1 回で no-op。
async function resyncFromCloud() {
  if (!cloudSynced || !cloud) return false;
  const cloudData = await cloud.fetchCloud();
  if (overwriting) return false;
  if (cloudData) reconcileInitialCloud(cloudData);
  else if (cloudData === null && hasLocalData(state)) cloud.pushCloud(cloudFields(state));
  return cloudData !== undefined;
}

// 印を下ろす条件は data-model.md #358
export const resyncAndSettle = () => resyncFromCloud()
  .then((ok) => {
    const offline = navigator.onLine === false;
    if (ok && !offline) offlineDirty = false;
    // 取り込めたか、いま保存しても送信されない（未接続・初回同期前）ときだけ。取れなければ次の再同期で
    if (overwriting || !(ok || offline || !initialSyncDone)) return;
    hooks.settled();
  });
let retryTimer = null;
function scheduleRetry() {
  retryTimer ??= setTimeout(() => { retryTimer = null; retryResync(); }, 30000);
}
function retryResync() {
  resyncAndSettle().then(() => { if (offlineDirty && navigator.onLine !== false) scheduleRetry(); });
}

// adopt(next): 取り込んだ state に差し替えて描き直す／settled(): 取り込みを終えたあとの続き
// （休んでいた間のレッスン日の取りこみ。取り込む前に保存・送信すると他の端末の記録を消す・#242）
export function startCloudSync({ adopt, settled }) {
  hooks = { adopt, settled };

  // オフライン起動後にネットワークが復帰したら同期を立ち上げ直す。
  window.addEventListener('online', () => {
    if (!cloudSynced) { initCloudSync(); return; }
    // 初回 reconcile 前は送らない（マージ前のローカル state で全置換すると他端末の記録を消す・#313）。
    // オフライン中の state は古いので union してから送る（#358）。
    if (initialSyncDone) retryResync();
  });
  window.addEventListener('offline', () => { offlineDirty = true; });

  // 初回のクラウド同期はブラウザのアイドル時間まで遅延し、初回描画・操作を妨げない（#142）。
  // renderHome は既に localStorage から同期描画済み。Firebase SDK の動的取得・初期化はここで初めて走る。
  // requestIdleCallback 非対応（一部 Safari 等）は短い setTimeout でフォールバック。
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => initCloudSync(), { timeout: 2000 });
  } else {
    setTimeout(() => initCloudSync(), 200);
  }
}
