import { createRouter, hashFromView, NAV_VIEWS } from './router.js';
import { loadState, saveState } from './storage.js';
import { catStage, todayStr, xpProgress, applySession } from './game.js';
import { catMarkup, playHappy } from './cat.js';
import { collectSongs, isValidSession } from './record-form.js';
import {
  sortByDateDesc,
  weeklyTotals,
  weeklyChartModel,
  formatDateJa,
} from './history.js';
import {
  SHOP_ITEMS,
  isOwned,
  isEquipped,
  canBuy,
  buyItem,
  toggleEquip,
} from './shop.js';
import { isSoundOn, toggleSound, playSound, unlockAudio } from './sound.js';
import { badgesWithStatus, earnedCount, newlyEarned, BADGES } from './badges.js';

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
  renderSoundToggle();
}

// サウンドON/OFFトグルの表示を state に同期
function renderSoundToggle() {
  const btn = document.getElementById('soundToggle');
  if (!btn) return;
  const on = isSoundOn(state);
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? '🔊' : '🔇';
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
  setText('statFreezes', state.streak.freezes ?? 0);

  const pct = xpPerLevel > 0 ? Math.round((xpInLevel / xpPerLevel) * 100) : 0;
  const fillEl = document.getElementById('statXpFill');
  if (fillEl) fillEl.style.width = `${pct}%`;
  const barEl = document.getElementById('statXpbar');
  if (barEl) barEl.setAttribute('aria-valuenow', String(pct));
}

// ===== 記録履歴画面（Epic 6） =====
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// 週ごとの合計回数を SVG の棒グラフにする
function weeklyChartSvg(bars) {
  const N = bars.length;
  const W = N * 30;
  const H = 120;
  const topPad = 12;     // 値ラベルの余白
  const baseline = H - 16; // 棒の下端（この下に週ラベル）
  const barMaxH = baseline - topPad;
  const slotW = W / N;
  const barW = slotW * 0.58;

  const parts = bars.map((b, i) => {
    const x = i * slotW + (slotW - barW) / 2;
    const cx = x + barW / 2;
    const h = b.total > 0 ? Math.max(3, Math.round(b.ratio * barMaxH)) : 0;
    const y = baseline - h;
    const value = b.total > 0
      ? `<text class="bar-value" x="${cx.toFixed(1)}" y="${(y - 3).toFixed(1)}">${b.total}</text>`
      : '';
    return `${value}<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h}" rx="3"/>` +
      `<text class="bar-label" x="${cx.toFixed(1)}" y="${H - 3}">${b.label}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">` +
    `<defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#ffd06a"/><stop offset="100%" stop-color="#ff7a93"/>` +
    `</linearGradient></defs>${parts.join('')}</svg>`;
}

function historyCardMarkup(session) {
  const songs = (session.songs ?? [])
    .map((s) => `<li><span class="song-title">${escapeHtml(s.name)}</span>` +
      `<span class="song-times">${Number(s.count) || 0}かい</span></li>`)
    .join('');
  return `<div class="history-card">
    <div class="history-card__date">
      <span class="history-card__day">${formatDateJa(session.date)}</span>
      <span class="history-card__total">ごうけい <b>${Number(session.totalCount) || 0}</b> かい</span>
    </div>
    <ul class="history-songs">${songs}</ul>
  </div>`;
}

export function renderHistory() {
  setText('historyStreakCurrent', state.streak.current);
  setText('historyStreakBest', state.streak.best);

  const chartEl = document.getElementById('weeklyChart');
  if (chartEl) {
    chartEl.innerHTML = weeklyChartSvg(weeklyChartModel(weeklyTotals(state.sessions)));
  }

  const listEl = document.getElementById('historyList');
  if (listEl) {
    const sessions = sortByDateDesc(state.sessions);
    listEl.innerHTML = sessions.length
      ? sessions.map(historyCardMarkup).join('')
      : '<p class="history-empty">まだ きろくが ないよ。<br>れんしゅうを きろくしてね！</p>';
  }
}

// ===== ショップ画面（Epic 7） =====
function shopCardMarkup(item) {
  const owned = isOwned(state, item.id);
  const equipped = isEquipped(state, item.id);

  let btn;
  if (!owned) {
    btn = canBuy(state, item.id)
      ? `<button type="button" class="shop-btn shop-btn--buy" data-action="buy" data-id="${item.id}">かう</button>`
      : `<button type="button" class="shop-btn shop-btn--locked" disabled>コインが たりない</button>`;
  } else if (equipped) {
    btn = `<button type="button" class="shop-btn shop-btn--unequip" data-action="toggle" data-id="${item.id}">はずす</button>`;
  } else {
    btn = `<button type="button" class="shop-btn shop-btn--equip" data-action="toggle" data-id="${item.id}">そうびする</button>`;
  }

  const badge = equipped ? '<span class="shop-card__badge">そうび中 ✓</span>' : '';
  return `<div class="shop-card${equipped ? ' shop-card--equipped' : ''}">
    <span class="shop-card__icon" aria-hidden="true">${item.icon}</span>
    <div class="shop-card__info">
      <span class="shop-card__name">${item.name}</span>
      <span class="shop-card__price">🪙 ${item.price}</span>
      ${badge}
    </div>
    ${btn}
  </div>`;
}

export function renderShop() {
  setText('shopCoins', state.pet.coins);
  const listEl = document.getElementById('shopList');
  if (listEl) listEl.innerHTML = SHOP_ITEMS.map(shopCardMarkup).join('');
}

// ===== バッジ画面（Epic 9） =====
function badgeCardMarkup(b) {
  return `<div class="badge-card${b.earned ? '' : ' badge-card--locked'}">
    <span class="badge-card__icon" aria-hidden="true">${b.earned ? b.icon : '🔒'}</span>
    <span class="badge-card__name">${b.name}</span>
    <span class="badge-card__desc">${b.desc}</span>
  </div>`;
}

export function renderBadges() {
  setText('badgesCount', `${earnedCount(state)} / ${BADGES.length} こ ゲット！`);
  const grid = document.getElementById('badgeGrid');
  if (grid) grid.innerHTML = badgesWithStatus(state).map(badgeCardMarkup).join('');
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
  if (view === 'record') resetRecordForm();
  if (view === 'history') renderHistory();
  if (view === 'shop') renderShop();
  if (view === 'badges') renderBadges();
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

// ===== 記録フォーム =====
const songRowsEl = document.getElementById('songRows');
const recordDateEl = document.getElementById('recordDate');
const recordTotalEl = document.getElementById('recordTotal');
const recordErrorEl = document.getElementById('recordError');

function songRowMarkup() {
  return `<div class="song-row">
    <input type="text" class="field-input song-name" placeholder="きょくめい" aria-label="きょくめい">
    <input type="number" class="field-input song-count" placeholder="0" min="0" step="1" inputmode="numeric" aria-label="かいすう">
    <button type="button" class="btn-remove-row" aria-label="この ぎょうを けす">✕</button>
  </div>`;
}

function readRows() {
  return Array.from(songRowsEl?.querySelectorAll('.song-row') ?? []).map((row) => ({
    name: row.querySelector('.song-name')?.value ?? '',
    count: row.querySelector('.song-count')?.value ?? '',
  }));
}

function updateTotal() {
  const { totalCount } = collectSongs(readRows());
  if (recordTotalEl) recordTotalEl.textContent = String(totalCount);
  if (recordErrorEl && totalCount > 0) recordErrorEl.hidden = true;
}

function addRow() {
  songRowsEl?.insertAdjacentHTML('beforeend', songRowMarkup());
}

function resetRecordForm() {
  if (recordDateEl) recordDateEl.value = todayStr();
  if (songRowsEl) songRowsEl.innerHTML = '';
  addRow();
  updateTotal();
  if (recordErrorEl) recordErrorEl.hidden = true;
}

function showCoinPopup({ coins, leveled, newLevel }) {
  const popup = document.getElementById('coinPopup');
  if (!popup) return;
  playSound('coin', state);       // コイン獲得音（ポップアップ表示に同期）
  document.getElementById('coinPopupAmount').textContent = `+${coins}`;
  const levelUpEl = document.getElementById('coinPopupLevelUp');
  if (levelUpEl) {
    levelUpEl.hidden = !leveled;
    levelUpEl.textContent = leveled ? `レベル ${newLevel} に アップ！🎉` : '';
  }
  popup.hidden = false;
  // リフローを挟んでアニメーションを確実に再生
  void popup.getBoundingClientRect();
  popup.classList.add('coin-popup--show');
  clearTimeout(showCoinPopup._t);
  showCoinPopup._t = setTimeout(() => {
    popup.classList.remove('coin-popup--show');
    popup.addEventListener('transitionend', () => { popup.hidden = true; }, { once: true });
  }, 2000);
}

// バッジ獲得ポップアップ（複数取得時も順番に表示）
function showBadgePopup(badges) {
  const popup = document.getElementById('badgePopup');
  if (!popup || !badges.length) return;
  let i = 0;
  const showNext = () => {
    if (i >= badges.length) return;
    const b = badges[i++];
    document.getElementById('badgePopupIcon').textContent = b.icon;
    document.getElementById('badgePopupName').textContent = b.name;
    popup.hidden = false;
    void popup.getBoundingClientRect();
    popup.classList.add('coin-popup--show');
    playSound('levelup', state);
    setTimeout(() => {
      popup.classList.remove('coin-popup--show');
      popup.addEventListener('transitionend', function done() {
        popup.removeEventListener('transitionend', done);
        popup.hidden = true;
        showNext();           // 次のバッジへ
      }, { once: true });
    }, 2200);
  };
  showNext();
}

// お休み券で連続を守ったときのポップアップ
function showFreezePopup() {
  const popup = document.getElementById('freezePopup');
  if (!popup) return;
  popup.hidden = false;
  void popup.getBoundingClientRect();
  popup.classList.add('coin-popup--show');
  playSound('coin', state);
  setTimeout(() => {
    popup.classList.remove('coin-popup--show');
    popup.addEventListener('transitionend', () => { popup.hidden = true; }, { once: true });
  }, 2200);
}

function submitRecord(event) {
  event.preventDefault();
  const date = recordDateEl?.value || todayStr();
  const { songs, totalCount } = collectSongs(readRows());

  if (!isValidSession({ totalCount })) {
    if (recordErrorEl) recordErrorEl.hidden = false;
    return;
  }

  const prevBadges = state.badges;
  const { state: newState, rewards } = applySession(state, { date, songs, totalCount });
  const gainedBadges = newlyEarned(prevBadges, newState.badges);
  commitState(newState);          // 保存 + ホーム再描画
  router.go('home');              // ホームへ遷移
  playHappy(document.querySelector('#catStage svg'));  // 喜ぶアニメ
  showCoinPopup(rewards);         // 獲得コインのポップアップ
  // 効果音：記録完了 →（レベルアップ時のみ）レベルアップ音
  playSound('record', state);
  if (rewards.leveled) playSound('levelup', state);
  // コインポップアップの後に、お休み券→新規バッジの順で表示
  let nextDelay = 2200;
  if (rewards.frozeDays > 0) {
    setTimeout(showFreezePopup, nextDelay);
    nextDelay += 2200;
  }
  if (gainedBadges.length) setTimeout(() => showBadgePopup(gainedBadges), nextDelay);
  resetRecordForm();
}

document.getElementById('addRowBtn')?.addEventListener('click', addRow);
songRowsEl?.addEventListener('input', updateTotal);
songRowsEl?.addEventListener('click', (e) => {
  if (!e.target.closest('.btn-remove-row')) return;
  const rows = songRowsEl.querySelectorAll('.song-row');
  if (rows.length <= 1) return;   // 最低1行は残す
  e.target.closest('.song-row').remove();
  updateTotal();
});
document.getElementById('recordForm')?.addEventListener('submit', submitRecord);

// ===== ショップの購入・装備操作 =====
document.getElementById('shopList')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.shop-btn[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const next = btn.dataset.action === 'buy' ? buyItem(state, id) : toggleEquip(state, id);
  if (next === state) return;       // 変化なし（買えない等）
  if (btn.dataset.action === 'buy') playSound('purchase', state);  // 購入音
  commitState(next);                // 保存 + ホームの猫へ即反映
  renderShop();                     // ショップ表示を更新
});

// ===== サウンドON/OFFトグル =====
document.getElementById('soundToggle')?.addEventListener('click', () => {
  unlockAudio();                    // ユーザー操作で AudioContext を解錠
  commitState(toggleSound(state));  // 設定を反転して保存（renderHome でボタン更新）
  if (isSoundOn(state)) playSound('coin', state);  // ONにした合図に短く鳴らす
});

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
