// ===== LocalStorage CRUD + 状態の正規化／クラウド射影 =====
const KEY = 'piano-pet';

const DEFAULTS = {
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
    return normalizeState(JSON.parse(raw));
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
