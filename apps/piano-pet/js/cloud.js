// ===== Firebase (Firestore) クラウド同期 =====
// dtask と同一スタック: SDK は CDN 直読み・config 直書き・認証なし（Firestore ルールでアクセス制御）。
// piano-pet は dtask プロジェクトを共有し、collection 'pianopet' / doc 'data' に保存する。
//
// このモジュールは Firebase SDK を CDN から読み込むため、app.js からは動的 import で取り込む。
// オフラインで CDN 取得に失敗してもアプリ本体（localStorage 動作）を巻き込まないようにするため。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { getActiveAccountId, cloudDocIdFor } from './account.js';

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
// 有効アカウントの保存先ドキュメント（マルチアカウント・#182）。アカウント切替時は
// ページをリロードして本モジュールを貼り直すため、import 時点の有効アカウントで固定してよい。
const DATA_DOC = doc(db, 'pianopet', cloudDocIdFor(getActiveAccountId()));

// 初回読み込み: クラウド doc を取得する。
//   - 存在すれば data() を返す（呼び出し側が local state にマージ）
//   - 存在しなければ null（呼び出し側で local→cloud 移行を判断）
// Firestore 無応答(オフライン等)は 5 秒でタイムアウトして null を返し、local 起動を妨げない。
export async function fetchCloud() {
  try {
    const snap = await Promise.race([
      getDoc(DATA_DOC),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 5000)),
    ]);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn('pianopet fetchCloud unavailable, using local only', err);
    return null;
  }
}

// クラウドへ保存（射影済みのデータオブジェクトを受け取る）。
export async function pushCloud(data) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  try {
    await setDoc(DATA_DOC, data);
  } catch (err) {
    console.warn('pianopet pushCloud failed', err);
  }
}

// 連続する保存をまとめてから送る（遅延バッチコミット・#146）。
// スタンプ連打や購入・えさやりの連続操作を 1 回の書き込みにまとめ、Firestore の
// 書き込み回数（＝通信量・課金）を抑える。delay 中に届いた最新データだけを保持し、
// タイマー満了か flushCloud() で送る。記録確定・タブ離脱時は flushCloud() で即送る。
let saveTimer = null;
let pendingData = null;
export function pushCloudDebounced(data, delay = 2000) {
  pendingData = data;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushCloud, delay);
}

// 保留中の書き込みがあれば即座に送る（記録確定・タブ非アクティブ/離脱時に呼ぶ）。
// 何も保留していなければ no-op。debounce 待ちのデータを取りこぼさないための確定経路。
// オフライン中は pushCloud が握りつぶすため、pendingData を消さずに保持し、
// 次の flush（次の記録確定・再オンライン後の debounce 満了）で送り直せるようにする（#288）。
export function flushCloud() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (pendingData == null) return undefined;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return undefined;
  const data = pendingData;
  pendingData = null;
  return pushCloud(data);
}

// ===== 保存先の移行（#233 段階1：固定doc → がぞくコード） =====
// 移行は「別の doc」への読み書きが要るが、DATA_DOC は import 時点の有効アカウントで固定なので
// doc ID を受け取る専用ヘルパを用意する（移行後はページをリロードして全体を貼り直す）。

// 任意の doc へ書く（移行先へのコピー・移行元の空化に使う）。成功したら true。
// 移行元の中身を読み直す必要はない：移行時点の state は既にローカル（＝購読で最新）にあるため、
// それを cloudFields で射影して書けばよい。
export async function pushCloudDoc(docId, data) {
  try {
    await setDoc(doc(db, 'pianopet', docId), data);
    return true;
  } catch (err) {
    console.warn('pianopet pushCloudDoc failed', err);
    return false;
  }
}

// 他端末の変更をリアルタイム反映。onRemote(data) を呼ぶ。
export function subscribeCloud(onRemote) {
  return onSnapshot(
    DATA_DOC,
    (snap) => { if (snap.exists()) onRemote(snap.data()); },
    (err) => console.warn('pianopet subscribe error', err),
  );
}
