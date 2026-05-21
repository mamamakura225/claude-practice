import { createRouter, hashFromView, NAV_VIEWS } from './router.js';
import { loadState, saveState } from './storage.js';
import { catStage, todayStr, xpProgress } from './game.js';
import { catMarkup } from './cat.js';

// ===== 状態管理 =====
export let state = loadState();

export function commitState(newState) {
  state = newState;
  saveState(state);
  renderHome();
}

// ===== ホームの猫表示（フル機能は Epic 4） =====
function moodForState(s) {
  const last = s.streak.lastPracticeDate;
  if (!last) return 'idle';
  const diffDays = Math.floor((Date.parse(todayStr()) - Date.parse(last)) / 86400000);
  return diffDays >= 2 ? 'sleep' : 'idle';
}

export function renderHome() {
  const stageEl = document.getElementById('catStage');
  if (stageEl) {
    stageEl.innerHTML = catMarkup({
      stage: catStage(state.pet.level),
      mood: moodForState(state),
      equippedItems: state.pet.equippedItems,
      name: state.pet.name,
    });
  }
  const nameEl = document.getElementById('petName');
  if (nameEl) nameEl.textContent = state.pet.name;

  renderStats();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// レベル・XPバー・コイン・ストリークの表示
function renderStats() {
  const { level, xpInLevel, xpPerLevel, toNextLevel } = xpProgress(state.pet.xp);

  setText('statLevel', level);
  setText('statToNext', `あと ${toNextLevel} かい で レベルアップ`);
  setText('statCoins', state.pet.coins);
  setText('statStreak', state.streak.current);

  const pct = xpPerLevel > 0 ? Math.round((xpInLevel / xpPerLevel) * 100) : 0;
  const fillEl = document.getElementById('statXpFill');
  if (fillEl) fillEl.style.width = `${pct}%`;
  const barEl = document.getElementById('statXpbar');
  if (barEl) barEl.setAttribute('aria-valuenow', String(pct));
}

// ===== ナビゲーション =====
const views = Array.from(document.querySelectorAll('.view'));
const navButtons = Array.from(document.querySelectorAll('.nav-btn'));

function render(view) {
  for (const el of views) {
    el.hidden = el.dataset.view !== view;
  }
  for (const btn of navButtons) {
    const active = btn.dataset.nav === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  }
  // record はナビに無いので、ナビ上は home を選択状態に保つ
  if (!NAV_VIEWS.includes(view)) {
    const homeBtn = navButtons.find((b) => b.dataset.nav === 'home');
    if (homeBtn) homeBtn.classList.add('active');
  }
  window.scrollTo(0, 0);
}

const router = createRouter({
  onChange(view) {
    render(view);
    const target = hashFromView(view);
    if (window.location.hash !== target) {
      window.location.hash = target;
    }
  },
});

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => router.go(btn.dataset.nav));
});

document.getElementById('goRecordBtn')?.addEventListener('click', () => router.go('record'));
document.getElementById('recordBackBtn')?.addEventListener('click', () => router.go('home'));

window.addEventListener('hashchange', () => router.syncFromHash(window.location.hash));

// 初期表示
renderHome();
router.syncFromHash(window.location.hash);

// ===== Service Worker 登録 =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // 登録失敗してもアプリ本体は動くので握りつぶす
    });
  });
}
