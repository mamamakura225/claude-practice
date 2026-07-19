// ===== アカウント切替（マルチアカウント・#182）=====
// piano-pet は認証なしで Firestore のドキュメントを直に読む設計（cloud.js）。アカウント分離は
// 「読み書きする Firestore ドキュメントと localStorage キーをアカウント単位で名前空間化する」だけの
// 最小構成で実現する。どのアカウントが有効かは端末ローカルの選択なのでクラウド(state)には載せない。
// 検証用の「テスト用」と実運用の「娘」を親ゲートの裏で切り替える（子の誤操作はゲートで防ぐ）。

// 有効アカウントと一覧を保持する端末ローカルキー（state とは別・クラウド非同期）。
const REGISTRY_KEY = 'piano-pet:accounts';

// 既定の2アカウント。'data' は既存データの保存先（Firestore `pianopet/data`・localStorage
// `piano-pet`）をそのまま指すため、本機能の導入で娘の既存データは一切移動しない。
export const DEFAULT_ACCOUNTS = [
  { id: 'data', name: '娘' },
  { id: 'test', name: 'テスト用' },
];

function readRegistry() {
  try {
    const raw = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? 'null');
    if (raw && Array.isArray(raw.accounts) && raw.accounts.length) return raw;
  } catch { /* 壊れていたら既定へ倒す */ }
  return { active: 'data', accounts: DEFAULT_ACCOUNTS };
}

export function getAccounts() {
  return readRegistry().accounts;
}

// 有効アカウントID。未知IDに化けていたら既定 'data'（娘）へ倒す。
export function getActiveAccountId() {
  const reg = readRegistry();
  return reg.accounts.some((a) => a.id === reg.active) ? reg.active : 'data';
}

// 有効アカウントを切り替える。呼び出し側はこの後ページをリロードして全モジュール
// （storage の参照キー・cloud の購読 doc）を新アカウントで貼り直す。
export function setActiveAccount(id) {
  const reg = readRegistry();
  if (!reg.accounts.some((a) => a.id === id)) return false;
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify({ ...reg, active: id }));
    return true;
  } catch {
    return false;
  }
}

// アカウントの localStorage キー。'data'（娘）は既存キー `piano-pet` を温存し、それ以外は
// `piano-pet:<id>` に名前空間化する（既存データの後方互換を保つ）。
export function storageKeyFor(id) {
  return id === 'data' ? 'piano-pet' : `piano-pet:${id}`;
}

// ===== クラウド保存先の doc ID（推測不能化・#233 段階1） =====
// 旧仕様は doc ID が固定・推測可能（`pianopet/data` / `pianopet/test`）で、Firebase config は
// クライアント埋め込みの公開情報のため、認証なしの現構成では第三者が到達できる構造だった。
// 段階1として doc ID を初回生成のランダム UUID（「がぞくコード」）に置き換える。
// 認証UIを増やさず、複数端末はコードを共有することで同じ doc を見る（#182 のアカウント分離は維持）。
const CLOUD_IDS_KEY = 'piano-pet:cloud-ids';

// 旧固定 doc ID（移行元）。アカウントIDがそのまま doc ID だった。
export function legacyCloudDocIdFor(id) {
  return id;
}

function readCloudIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(CLOUD_IDS_KEY) ?? 'null');
    if (raw && typeof raw === 'object') return raw;
  } catch { /* 壊れていたら空へ倒す */ }
  return {};
}

// アカウントに紐づく「がぞくコード」（=doc ID）。未移行なら null。
export function getCloudDocId(accountId) {
  const v = readCloudIds()[accountId];
  return typeof v === 'string' && v ? v : null;
}

// がぞくコードを保存する（移行時／他端末での合流時）。
export function setCloudDocId(accountId, docId) {
  if (!isValidCloudDocId(docId)) return false;
  try {
    localStorage.setItem(CLOUD_IDS_KEY, JSON.stringify({ ...readCloudIds(), [accountId]: docId }));
    return true;
  } catch {
    return false;
  }
}

// 推測不能な doc ID を生成する。crypto.randomUUID があれば優先、無ければ乱数16進で代替。
export function generateCloudDocId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `pp-${uuid}`;
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `pp-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// 入力されたコードが doc ID として妥当か（Firestore doc ID に使える文字・長さ）。
// 手入力を想定するため前後空白は呼び出し側で trim してから渡す。
export function isValidCloudDocId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(value) && value !== '.' && value !== '..';
}

// アカウントの Firestore ドキュメントID（collection `pianopet` 内）。
// 移行済みなら「がぞくコード」、未移行は旧固定ID（=後方互換。移行するまで挙動は変わらない）。
export function cloudDocIdFor(id) {
  return getCloudDocId(id) ?? legacyCloudDocIdFor(id);
}
