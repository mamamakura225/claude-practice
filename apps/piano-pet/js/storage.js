// ===== LocalStorage CRUD + 状態の正規化／クラウド射影 =====
import { getActiveAccountId, storageKeyFor } from './account.js';

// 有効アカウントの localStorage キー（マルチアカウント・#182）。アカウントごとに
// キャッシュを分離するため、固定値ではなく有効アカウントから都度導出する。
export function activeStorageKey() {
  return storageKeyFor(getActiveAccountId());
}

// localStorage に保存する state の現行スキーマバージョン。
// 構造を破壊的に変更したらここを +1 し、MIGRATIONS に移行ステップを追加する。
export const SCHEMA_VERSION = 2;

const DEFAULTS = {
  version: SCHEMA_VERSION,
  pet: {
    name: 'きーちゃん',
    level: 1,
    xp: 0,
    coins: 0,
    equippedItems: [],
    // 衣装の自由配置座標（#168）。{ itemId: { x_pct, y_pct } }。
    // 未登録のアイテムは cat-image.js が既定アンカー位置で描く（フォールバック）。
    itemLayout: {},
    affinity: 0,
    foodSpent: 0,
    // 猫スタイル（#66）。'tora' | 'shiro' | 'russianblue'。未知値は表示側が tora にフォールバック。
    catStyle: 'tora',
  },
  inventory: [],
  streak: {
    current: 0,
    best: 0,
    lastPracticeDate: null,
    freezes: 0,
  },
  badges: [],
  sessions: [],
  // 宿題（きょうの きょく・#143）。親が設定する単一値。未設定は null。
  // 形: { items: [{ name, target }], period: 'day'|'week', setAt: ISO文字列 }。
  // sessions から導出されないため LWW（setAt 比較）で同期する。
  assignment: null,
  settings: {
    soundOn: true,
  },
};

// 各ステップは「v(index) の state を受け取り v(index+1) の形に変換して返す純粋関数」。
// version フィールドの付与は migrate() が行うので、ここでは構造変換だけを書く。
// 例: v1→v2 で sessions の形を変えるなら MIGRATIONS[1] に変換を追加する。
const MIGRATIONS = [
  // v0 (バージョン番号を持たないレガシーデータ) → v1: 構造変更なし。version 付与のみ。
  (s) => s,
  // v1 → v2: 衣装の自由配置 pet.itemLayout を導入（#168）。
  // 既定値の補完は normalizeState が行うため、ここでは version 付与のみ。
  (s) => s,
];

// 保存データのスキーマバージョンを現行 (SCHEMA_VERSION) まで順に引き上げる。
// version を持たない旧データは v0 とみなす。現行より新しいデータ
// (ダウングレード時など) はそのまま返し、バージョンを下げない。
export function migrate(saved) {
  let s = saved ?? {};
  let v = Number.isInteger(s.version) ? s.version : 0;
  while (v < SCHEMA_VERSION && MIGRATIONS[v]) {
    s = MIGRATIONS[v](s);
    v += 1;
  }
  return { ...s, version: v };
}

// クラウド(Firestore)へ保存するフィールド。settings は端末ローカル設定なので含めない。
// assignment は親が別端末で設定→子端末で見たいので同期する（マージは LWW・#143）。
export const CLOUD_FIELDS = ['pet', 'inventory', 'streak', 'badges', 'sessions', 'assignment'];

// 保存値に DEFAULTS を補完してアプリが前提とする形に整える。
// localStorage の読み込みとクラウドデータの取り込みの両方で使う。
export function normalizeState(saved) {
  const s = saved ?? {};
  return {
    ...structuredClone(DEFAULTS),
    ...s,
    pet: { ...DEFAULTS.pet, ...(s.pet ?? {}) },
    streak: { ...DEFAULTS.streak, ...(s.streak ?? {}) },
    settings: { ...DEFAULTS.settings, ...(s.settings ?? {}) },
  };
}

// state からクラウドに載せるフィールドだけを抜き出す。
export function cloudFields(state) {
  const out = {};
  for (const k of CLOUD_FIELDS) out[k] = state[k];
  return out;
}

// assignment の setAt をミリ秒に直す（無効・未設定は 0）。
function assignmentTime(a) {
  const t = Date.parse(a?.setAt);
  return Number.isFinite(t) ? t : 0;
}

// 宿題(assignment)の Last-Write-Wins マージ。sessions の keep-larger とは別ロジックで、
// 親が直近に設定した単一値が正となるよう setAt の新しい方を採る（#143）。
// 片方が null/未設定なら非 null 側を採る。setAt 同値はローカル(a)優先。
// クリアは items:[] のトゥームストーン（setAt 付き）で表すため、これも LWW で伝播する。
export function pickNewerAssignment(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return assignmentTime(b) > assignmentTime(a) ? b : a;
}

// ローカル state にクラウドのデータフィールドを重ねる（realtime onSnapshot 経路: cloud-wins）。
// settings 等の端末ローカル値は cloud に無いので保持される。
// 初回 fetchCloud の取り込みは clobber を避けるため mergeCloudInitial を使う（#142）。
export function mergeCloud(local, cloud) {
  const picked = {};
  for (const k of CLOUD_FIELDS) {
    if (k === 'assignment') continue;                        // assignment は LWW で別処理
    if (cloud && cloud[k] !== undefined) picked[k] = cloud[k];
  }
  const merged = normalizeState({ ...local, ...picked });
  merged.assignment = pickNewerAssignment(local?.assignment, cloud?.assignment);
  return merged;
}

// sessions を date をキーに 1 日 1 件へ解決する（keep-larger）。
// 両側に同じ日付があれば totalCount の大きい方をそのまま採用し、合算しない。
// 合算すると部分同期後の共有ベースを二重計上してコイン/XP が水増しされるため
// （record ID/vector clock が無い前提での安全側。設計合意 topic_1780534255497 / #142）。
// 並びはアプリ慣習に合わせ date 降順（新しい順）。tie（同回数）はローカル優先。
// 例外: bonusCoins（きょうのおまけ #148）は totalCount から導出されない当選値なので、
// 衝突時は双方の max を採用してどちらかの端末で当たったおまけを消さない（affinity/foodSpent と同じ哲学）。
export function mergeSessionsKeepLarger(localSessions, cloudSessions) {
  const byDate = new Map();
  const consider = (s) => {
    if (!s || s.date == null) return;
    const prev = byDate.get(s.date);
    if (!prev) { byDate.set(s.date, { ...s }); return; }
    // 練習量の多い方を基本採用しつつ、きょうのおまけ(#148)はどちらかの当選を救済（max）。
    // bonusCoins は totalCount から導出されない当選フラグなので keep-larger で消さない。
    const chosen = (Number(s.totalCount) || 0) > (Number(prev.totalCount) || 0) ? s : prev;
    const bonusCoins = Math.max(Number(prev.bonusCoins) || 0, Number(s.bonusCoins) || 0);
    byDate.set(s.date, { ...chosen, bonusCoins });
  };
  for (const s of localSessions ?? []) consider(s);   // local を先に（tie でローカルが残る）
  for (const s of cloudSessions ?? []) consider(s);
  return [...byDate.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// 初回クラウド同期専用の「ローカル優先」マージ（#142）。
// 起動直後にローカルで記録した内容を消さないよう、フィールドごとに無損失寄りで突き合わせる。
//   - sessions: mergeSessionsKeepLarger（keep-larger）
//   - inventory: 重複 ID を除いた union（所有は単調増加）
//   - equippedItems: 両端末の union のうちマージ後 inventory に含まれるものだけ
//   - pet.affinity / pet.foodSpent: sessions から導出されない累積値なので max
// pet.coins/xp/level・streak・badges は sessions から導出されるため、呼び出し側で
// recomputeState を通して再計算する（このモジュールは game ロジックに依存しない）。
export function mergeCloudInitial(local, cloud) {
  const l = normalizeState(local);
  if (!cloud) return l;
  const c = normalizeState(cloud);

  const inventory = [...new Set([...(l.inventory ?? []), ...(c.inventory ?? [])])];
  const owned = new Set(inventory);
  const equippedItems = [...new Set([...(l.pet.equippedItems ?? []), ...(c.pet.equippedItems ?? [])])]
    .filter((id) => owned.has(id));

  return normalizeState({
    ...l,
    inventory,
    sessions: mergeSessionsKeepLarger(l.sessions, c.sessions),
    assignment: pickNewerAssignment(l.assignment, c.assignment),   // 宿題は LWW（#143）
    pet: {
      ...l.pet,
      equippedItems,
      affinity: Math.max(l.pet.affinity ?? 0, c.pet.affinity ?? 0),
      foodSpent: Math.max(l.pet.foodSpent ?? 0, c.pet.foodSpent ?? 0),
    },
  });
}

export function loadState() {
  try {
    const raw = localStorage.getItem(activeStorageKey());
    if (!raw) return structuredClone(DEFAULTS);
    return normalizeState(migrate(JSON.parse(raw)));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveState(state) {
  localStorage.setItem(activeStorageKey(), JSON.stringify(state));
}

export function clearState() {
  localStorage.removeItem(activeStorageKey());
}
