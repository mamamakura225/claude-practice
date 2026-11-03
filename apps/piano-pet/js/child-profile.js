// ===== こどもプロフィール（#121） =====
// ヘッダ隅に出す「自分のアイコン」。顔写真は使わず絵文字から選ぶ
// （認証なしの共有 Firestore に保存するためプライバシー配慮・PIIを増やさない）。

// 選べるアイコン（絵文字）。id はクラウド同期する安定キー、emoji は表示、label は読み上げ（#397）。
export const CHILD_AVATARS = [
  { id: 'chick', emoji: '🐥', label: 'ひよこ' },
  { id: 'rabbit', emoji: '🐰', label: 'うさぎ' },
  { id: 'bear', emoji: '🐻', label: 'くま' },
  { id: 'panda', emoji: '🐼', label: 'パンダ' },
  { id: 'fox', emoji: '🦊', label: 'きつね' },
  { id: 'frog', emoji: '🐸', label: 'かえる' },
  { id: 'star', emoji: '⭐', label: 'ほし' },
  { id: 'flower', emoji: '🌸', label: 'おはな' },
  { id: 'unicorn', emoji: '🦄', label: 'ユニコーン' },
  { id: 'crown', emoji: '👑', label: 'おうかん' },
];

// 未設定・未知IDのフォールバック先。
export const DEFAULT_CHILD_AVATAR = 'chick';

// アイコンIDを既知のものに正規化する（未知・未設定は既定へ）。
export function normalizeChildAvatar(id) {
  return CHILD_AVATARS.some((a) => a.id === id) ? id : DEFAULT_CHILD_AVATAR;
}

// アイコンIDから表示用の絵文字を返す（未知・未設定は既定の絵文字）。
export function avatarEmoji(id) {
  const found = CHILD_AVATARS.find((a) => a.id === id);
  return (found ?? CHILD_AVATARS.find((a) => a.id === DEFAULT_CHILD_AVATAR)).emoji;
}

// 子の名前を整える。前後空白を落とし、長すぎる入力は12文字に丸める。
export function normalizeChildName(name) {
  return String(name ?? '').trim().slice(0, 12);
}
