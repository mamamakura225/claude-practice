// ===== Firebase (Firestore) クラウド同期 =====
// dtask と同一スタック: SDK は CDN 直読み・config 直書き・認証なし（Firestore ルールでアクセス制御）。
// piano-pet は dtask プロジェクトを共有し、collection 'pianopet' / doc 'data' に保存する。
//
// このモジュールは Firebase SDK を CDN から読み込むため、app.js からは動的 import で取り込む。
// オフラインで CDN 取得に失敗してもアプリ本体（localStorage 動作）を巻き込まないようにするため。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBEN2Cd1CGzC3aN9hHS4m8o1MCnF6z5oBk",
  authDomain: "dtask-d08b6.firebaseapp.com",
  projectId: "dtask-d08b6",
  storageBucket: "dtask-d08b6.firebasestorage.app",
  messagingSenderId: "459534305297",
  appId: "1:459534305297:web:f30a96b68d3fc2dc3e49b0"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const DATA_DOC = doc(db, 'pianopet', 'data');

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

// 連続する保存をまとめてから送る（トグル連打などの多重書き込みを抑制）。
let saveTimer = null;
export function pushCloudDebounced(data, delay = 500) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => pushCloud(data), delay);
}

// 他端末の変更をリアルタイム反映。onRemote(data) を呼ぶ。
export function subscribeCloud(onRemote) {
  return onSnapshot(
    DATA_DOC,
    (snap) => { if (snap.exists()) onRemote(snap.data()); },
    (err) => console.warn('pianopet subscribe error', err),
  );
}
