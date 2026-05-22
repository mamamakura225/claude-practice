// ===== LocalStorage CRUD =====
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
  },
  badges: [],
  sessions: [],
  settings: {
    soundOn: true,
  },
};

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const saved = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULTS),
      ...saved,
      pet: { ...DEFAULTS.pet, ...(saved.pet ?? {}) },
      streak: { ...DEFAULTS.streak, ...(saved.streak ?? {}) },
      settings: { ...DEFAULTS.settings, ...(saved.settings ?? {}) },
    };
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
