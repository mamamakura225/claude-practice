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

// アカウントの Firestore ドキュメントID（collection `pianopet` 内）。ID をそのまま使う。
export function cloudDocIdFor(id) {
  return id;
}
