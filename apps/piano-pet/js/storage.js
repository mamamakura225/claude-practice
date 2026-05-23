// ===== LocalStorage CRUD + 状態の正規化／クラウド射影 =====
const KEY = 'piano-pet';

// localStorage に保存する state の現行スキーマバージョン。
// 構造を破壊的に変更したらここを +1 し、MIGRATIONS に移行ステップを追加する。
export const SCHEMA_VERSION = 1;

const DEFAULTS = {
  version: SCHEMA_VERSION,
  pet: {
    name: 'きーちゃん',
    level: 1,
    xp: 0,
    coins: 0,
    equippedItems: [],
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
export const CLOUD_FIELDS = ['pet', 'inventory', 'streak', 'badges', 'sessions'];

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

// ローカル state にクラウドのデータフィールドを重ねる。
// settings 等の端末ローカル値は cloud に無いので保持される。
export function mergeCloud(local, cloud) {
  const picked = {};
  for (const k of CLOUD_FIELDS) {
    if (cloud && cloud[k] !== undefined) picked[k] = cloud[k];
  }
  return normalizeState({ ...local, ...picked });
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    return normalizeState(migrate(JSON.parse(raw)));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function clearState() {
  localStorage.removeItem(KEY);
}
