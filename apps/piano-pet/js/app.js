import { createRouter, hashFromView, NAV_VIEWS } from './router.js';
import { loadState, saveState, cloudFields, mergeCloud } from './storage.js';
import { catStage, todayStr, xpProgress, applySession, recomputeState, dailyProgress, mergeSameDaySessions, DAILY_GOAL } from './game.js';
import { catMarkup, playHappy, playReaction } from './cat.js';
import { isValidSession, stampsToSongs, songsToStamps, pastSongNames } from './record-form.js';
import {
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
  spentCoins,
} from './shop.js';
import { FOODS, foodById, canFeed, feedCat, foodSpent, affinity } from './feed.js';
import { isSoundOn, toggleSound, playSound, playMeow, unlockAudio } from './sound.js';
import { badgesWithStatus, earnedCount, newlyEarned, BADGES } from './badges.js';
import { initErrorMonitoring } from './sentry.js';
import { initAnalytics, track } from './analytics.js';

// エラー監視・利用計測（任意・キー未設定なら no-op）。早期に起動する。
initErrorMonitoring();
initAnalytics();

// ===== 状態管理 =====
export let state = loadState();

// 旧データに同日重複セッションがある場合は統合して再計算（一回限りのマイグレーション）
{
  const migrated = mergeSameDaySessions(state.sessions);
  if (migrated.length < state.sessions.length) {
    state = recomputeState({ ...state, sessions: migrated }, spentTotal(state));
    saveState(state);
  }
}

// クラウド同期モジュール（./cloud.js）。動的 import が成功したら入る。
// オフライン等で読み込めない場合は null のまま＝localStorage だけで動作する。
let cloud = null;

// 装備購入＋えさやりに使ったコイン総額。全再計算（recomputeState）の spent 引数に使う。
// 所持コイン = 獲得総額 - この値。どちらかが漏れると編集・削除で消費分が復活してしまう。
function spentTotal(s) {
  return spentCoins(s) + foodSpent(s);
}

export function commitState(newState) {
  state = newState;
  saveState(state);                 // ローカルキャッシュ（オフライン用）
  if (cloud) cloud.pushCloudDebounced(cloudFields(state));  // クラウドへ反映（読み込み済みのときだけ）
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

// 今日の目標（○/10回）の進捗表示
function renderDailyGoal() {
  const goal = dailyProgress(state.sessions, todayStr());
  setText('statGoalCount', goal.count);

  const fillEl = document.getElementById('statGoalFill');
  if (fillEl) fillEl.style.width = `${Math.round(goal.ratio * 100)}%`;
  const barEl = document.getElementById('statGoalbar');
  if (barEl) barEl.setAttribute('aria-valuenow', String(Math.min(goal.count, goal.goal)));

  setText('statGoalMsg', goal.achieved ? 'もくひょう たっせい！🎉' : `あと ${goal.remaining} かい！`);
  document.getElementById('goalBlock')?.classList.toggle('goal-block--done', goal.achieved);
}

// レベル・XPバー・コイン・ストリークの表示
function renderStats() {
  renderDailyGoal();

  const { level, xpInLevel, xpPerLevel, toNextLevel } = xpProgress(state.pet.xp);

  setText('statLevel', level);
  setText('statToNext', `あと ${toNextLevel} かい で レベルアップ`);
  setText('statCoins', state.pet.coins);
  setText('statStreak', state.streak.current);
  setText('statFreezes', state.streak.freezes ?? 0);
  setText('statAffinity', affinity(state));

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

function historyCardMarkup(session, index) {
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
    <div class="history-card__actions">
      <button type="button" class="history-action" data-action="edit-session" data-index="${index}" aria-label="この きろくを なおす">✏️ なおす</button>
      <button type="button" class="history-action history-action--del" data-action="delete-session" data-index="${index}" aria-label="この きろくを けす">🗑️ けす</button>
    </div>
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
    // 元配列のインデックスを保持したまま新しい順に並べる（編集・削除の参照用）
    const indexed = state.sessions.map((s, i) => ({ s, i }));
    indexed.sort((a, b) => String(b.s.date).localeCompare(String(a.s.date)));
    listEl.innerHTML = indexed.length
      ? indexed.map(({ s, i }) => historyCardMarkup(s, i)).join('')
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

function feedCardMarkup(food) {
  const affordable = canFeed(state, food.id);
  const btn = affordable
    ? `<button type="button" class="shop-btn shop-btn--buy" data-action="feed" data-id="${food.id}">あげる</button>`
    : `<button type="button" class="shop-btn shop-btn--locked" disabled>コインが たりない</button>`;
  return `<div class="shop-card">
    <span class="shop-card__icon" aria-hidden="true">${food.icon}</span>
    <div class="shop-card__info">
      <span class="shop-card__name">${food.name}</span>
      <span class="shop-card__price">🪙 ${food.price}　💖 +${food.affinity}</span>
    </div>
    ${btn}
  </div>`;
}

export function renderShop() {
  setText('shopCoins', state.pet.coins);
  setText('feedAffinity', affinity(state));
  const feedEl = document.getElementById('feedList');
  if (feedEl) feedEl.innerHTML = FOODS.map(feedCardMarkup).join('');
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
    track('view_changed', { view });
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

// ===== 記録フォーム（スタンプカード方式） =====
const recordDateEl = document.getElementById('recordDate');
const recordTotalEl = document.getElementById('recordTotal');
const recordErrorEl = document.getElementById('recordError');
const songChipsEl = document.getElementById('songChips');
const newSongInputEl = document.getElementById('newSongInput');
const stampCardEl = document.getElementById('stampCard');
const stampHintEl = document.getElementById('stampHint');
const songSuggestEl = document.getElementById('songSuggestions');

// 新規曲入力欄(datalist)を過去の全曲で補完候補にする。チップは上位数曲のみ表示するため、
// 曲数が多い家庭でも手打ちせず履歴から選べるようにする（#77）。
function renderSongSuggestions() {
  if (!songSuggestEl) return;
  songSuggestEl.innerHTML = pastSongNames(state.sessions, Infinity)
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join('');
}

// 押した順の曲名（stamps）と、選択中の曲・チップ候補。記録のたびに作り直す。
let stamps = [];
let selectedSong = null;
let chipNames = [];

function renderChips() {
  if (!songChipsEl) return;
  songChipsEl.innerHTML = chipNames
    .map((name) => {
      const selected = name === selectedSong;
      return `<button type="button" class="song-chip${selected ? ' is-selected' : ''}" role="option" aria-selected="${selected}" data-song="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
    })
    .join('');
}

function selectSong(name) {
  selectedSong = name;
  if (stampHintEl) stampHintEl.hidden = true;
  renderChips();
}

function addNewSong() {
  const name = (newSongInputEl?.value ?? '').trim();
  if (!name) return;
  if (!chipNames.includes(name)) chipNames.unshift(name);
  if (newSongInputEl) newSongInputEl.value = '';
  selectSong(name);
}

// スタンプカードを描画。最低10マス、超過時は常に1マス余分に出して押し続けられるようにする。
function renderStampCard() {
  if (!stampCardEl) return;
  const filled = stamps.length;
  const cells = Math.max(DAILY_GOAL, filled + 1);
  let html = '';
  for (let i = 0; i < cells; i += 1) {
    const isFilled = i < filled;
    const isGoal = i === DAILY_GOAL - 1;
    html += `<span class="stamp-cell${isFilled ? ' is-filled' : ''}${isGoal ? ' is-goal' : ''}" aria-hidden="true">${isFilled ? '🐾' : ''}</span>`;
  }
  stampCardEl.innerHTML = html;
  stampCardEl.classList.toggle('is-complete', filled >= DAILY_GOAL);
  updateProgress();
}

function updateProgress() {
  if (recordTotalEl) recordTotalEl.textContent = String(stamps.length);
  if (recordErrorEl && stamps.length > 0) recordErrorEl.hidden = true;
}

function addStamp() {
  if (!selectedSong) {
    if (stampHintEl) stampHintEl.hidden = false;
    return;
  }
  const reachedGoal = stamps.length + 1 === DAILY_GOAL;
  stamps.push(selectedSong);
  renderStampCard();
  playSound('stamp', state);
  if (reachedGoal) playSound('levelup', state);
}

function undoStamp() {
  if (!stamps.length) return;
  stamps.pop();
  renderStampCard();
}

// 編集中の記録（state.sessions のインデックス）。新規記録時は null。
let editingIndex = null;

// 記録フォームの見出しとボタンを「新規」か「編集」かで切り替える
function setRecordMode(isEdit) {
  setText('recordTitle', isEdit ? 'きろくを なおす' : 'れんしゅうを きろく');
  const submit = document.getElementById('recordSubmitBtn');
  if (submit) submit.textContent = isEdit ? 'なおす' : 'きろくする';
}

function resetRecordForm() {
  editingIndex = null;
  setRecordMode(false);
  if (recordDateEl) recordDateEl.value = todayStr();
  stamps = [];
  chipNames = pastSongNames(state.sessions);
  selectedSong = chipNames[0] ?? null;
  if (newSongInputEl) newSongInputEl.value = '';
  if (stampHintEl) stampHintEl.hidden = true;
  renderChips();
  renderSongSuggestions();
  renderStampCard();
  if (recordErrorEl) recordErrorEl.hidden = true;
}

// 既存セッションの内容をフォームに流し込み、編集モードにする
function fillRecordForm(session) {
  if (recordDateEl) recordDateEl.value = session.date;
  stamps = songsToStamps(session.songs ?? []);
  // 編集対象の曲を候補の先頭に立て、過去曲も合わせて選べるようにする
  const editedNames = [...new Set(stamps)];
  chipNames = [...editedNames, ...pastSongNames(state.sessions).filter((n) => !editedNames.includes(n))];
  selectedSong = editedNames[editedNames.length - 1] ?? chipNames[0] ?? null;
  if (newSongInputEl) newSongInputEl.value = '';
  if (stampHintEl) stampHintEl.hidden = true;
  setRecordMode(true);
  renderChips();
  renderSongSuggestions();
  renderStampCard();
  if (recordErrorEl) recordErrorEl.hidden = true;
}

// 履歴から編集を開始：record 画面へ切り替えてからフォームを埋める
function startEditSession(index) {
  const session = state.sessions[index];
  if (!session) return;
  router.go('record');     // render() 内の resetRecordForm が editingIndex を一旦 null に戻す
  editingIndex = index;
  fillRecordForm(session);
}

// 履歴から削除：確認のうえ該当セッションを除き、全再計算して保存
function deleteSession(index) {
  const session = state.sessions[index];
  if (!session) return;
  if (!window.confirm(`${formatDateJa(session.date)} の きろくを けしますか？`)) return;
  const sessions = state.sessions.filter((_, i) => i !== index);
  commitState(recomputeState({ ...state, sessions }, spentTotal(state)));
  renderHistory();
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

// えさやりのポップアップ（もぐもぐ＋なかよし上昇）
function showFeedPopup(food) {
  const popup = document.getElementById('feedPopup');
  if (!popup) return;
  setText('feedPopupIcon', food.icon);
  setText('feedPopupGain', `+${food.affinity}`);
  popup.hidden = false;
  void popup.getBoundingClientRect();
  popup.classList.add('coin-popup--show');
  clearTimeout(showFeedPopup._t);
  showFeedPopup._t = setTimeout(() => {
    popup.classList.remove('coin-popup--show');
    popup.addEventListener('transitionend', () => { popup.hidden = true; }, { once: true });
  }, 1800);
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
  const { songs, totalCount } = stampsToSongs(stamps);

  if (!isValidSession({ totalCount })) {
    if (recordErrorEl) recordErrorEl.hidden = false;
    return;
  }

  // 編集モード：該当セッションを置き換えて全再計算（報酬演出はしない）
  // 日付変更による同日衝突も mergeSameDaySessions で統合する
  if (editingIndex != null) {
    const sessions = state.sessions.map((s, i) =>
      i === editingIndex ? { ...s, date, songs, totalCount } : s);
    commitState(recomputeState({ ...state, sessions: mergeSameDaySessions(sessions) }, spentTotal(state)));
    resetRecordForm();
    router.go('history');
    return;
  }

  // 同日に既存セッションがある場合は統合して全再計算（目標達成ボーナスの二重取りを防ぐ）
  const existingIndex = state.sessions.findIndex((s) => s.date === date);
  if (existingIndex !== -1) {
    const existing = state.sessions[existingIndex];
    const mergedSongs = [...existing.songs, ...songs];
    const mergedCount = existing.totalCount + totalCount;
    const sessions = state.sessions.map((s, i) =>
      i === existingIndex ? { ...s, songs: mergedSongs, totalCount: mergedCount } : s);
    const prevCoins = state.pet.coins;
    const prevLevel = state.pet.level;
    const prevBadges = state.badges;
    const newState = recomputeState({ ...state, sessions }, spentTotal(state));
    const gainedBadges = newlyEarned(prevBadges, newState.badges);
    commitState(newState);
    track('practice_recorded', { totalCount: mergedCount }); // 回数のみ・曲名は送らない
    router.go('home');
    playHappy(document.querySelector('#catStage svg'));
    showCoinPopup({ coins: Math.max(0, newState.pet.coins - prevCoins), leveled: newState.pet.level > prevLevel, newLevel: newState.pet.level });
    playSound('record', state);
    if (newState.pet.level > prevLevel) playSound('levelup', state);
    if (gainedBadges.length) setTimeout(() => showBadgePopup(gainedBadges), 2200);
    resetRecordForm();
    return;
  }

  const prevBadges = state.badges;
  const { state: newState, rewards } = applySession(state, { date, songs, totalCount });
  const gainedBadges = newlyEarned(prevBadges, newState.badges);
  commitState(newState);          // 保存 + ホーム再描画
  track('practice_recorded', { totalCount }); // 回数のみ・曲名は送らない
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

songChipsEl?.addEventListener('click', (e) => {
  const chip = e.target.closest('.song-chip');
  if (!chip) return;
  selectSong(chip.dataset.song);
});
document.getElementById('addSongBtn')?.addEventListener('click', addNewSong);
newSongInputEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  addNewSong();
});
stampCardEl?.addEventListener('click', addStamp);
document.getElementById('undoStampBtn')?.addEventListener('click', undoStamp);
document.getElementById('recordForm')?.addEventListener('submit', submitRecord);

// ===== 記録履歴の編集・削除 =====
document.getElementById('historyList')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const index = Number(btn.dataset.index);
  if (btn.dataset.action === 'edit-session') startEditSession(index);
  else if (btn.dataset.action === 'delete-session') deleteSession(index);
});

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

// ===== えさやり（#80・コインの使い道） =====
document.getElementById('feedList')?.addEventListener('click', (e) => {
  unlockAudio();
  const btn = e.target.closest('.shop-btn[data-action="feed"]');
  if (!btn) return;
  const id = btn.dataset.id;
  const next = feedCat(state, id);
  if (next === state) return;        // 買えない（コイン不足等）
  commitState(next);                 // 保存 + ホーム再描画（なかよし反映）
  renderShop();                      // ショップのコイン・なかよし・ボタン更新
  playSound('record', state);        // もぐもぐ（やわらかいチャイム）
  showFeedPopup(foodById(id));
});

// ===== 猫とのインタラクション（#79） =====
// なでる/タップで反応（鳴く・喜ぶ・しっぽふり）。記録には影響しない安全な操作。
function petCat() {
  unlockAudio();                                       // ユーザー操作で AudioContext を解錠
  playReaction(document.querySelector('#catStage svg'));
  playMeow(state);                                     // 本物の猫の鳴き声をランダム再生
}
document.getElementById('catStage')?.addEventListener('click', petCat);
document.getElementById('petBtn')?.addEventListener('click', petCat);

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

// ===== クラウド同期（Firestore） =====
// ローカルで即描画したあと、クラウドと突き合わせる。SDK は CDN 読み込みなので
// 動的 import で取り込み、失敗（オフライン等）してもローカル動作を妨げない。

// クラウドのデータを現在の state に取り込んで再描画する。
// 自分の書き込みのエコーなど「実質変化なし」のときは再描画をスキップする。
function applyRemoteState(cloudData) {
  const merged = mergeCloud(state, cloudData);
  if (JSON.stringify(cloudFields(merged)) === JSON.stringify(cloudFields(state))) return;
  state = merged;
  saveState(state);            // ローカルキャッシュも最新に
  renderHome();
  if (router.current === 'history') renderHistory();
  else if (router.current === 'shop') renderShop();
  else if (router.current === 'badges') renderBadges();
}

// ローカルに引き継ぐ価値のあるデータがあるか（初回クラウド移行の判定用）。
function hasLocalData(s) {
  return s.sessions.length > 0 || s.badges.length > 0 || s.inventory.length > 0
    || s.pet.coins > 0 || s.pet.xp > 0 || s.pet.level > 1;
}

let cloudSynced = false;
async function initCloudSync() {
  if (cloudSynced) return;
  try {
    cloud = await import('./cloud.js');     // CDN 取得に失敗すると reject
  } catch (err) {
    cloud = null;
    console.warn('クラウド同期は利用できません（オフライン等）。ローカルのみで動作します。', err);
    return;                                 // 'online' 復帰時に再試行
  }
  cloudSynced = true;
  const cloudData = await cloud.fetchCloud();
  if (cloudData) {
    applyRemoteState(cloudData);            // クラウドを正本として反映
  } else if (hasLocalData(state)) {
    await cloud.pushCloud(cloudFields(state));  // 初回: 既存のローカルデータを移行
  }
  cloud.subscribeCloud(applyRemoteState);   // 以降は他端末の変更をリアルタイム反映
}

// オフライン起動後にネットワークが復帰したら同期を立ち上げ直す。
window.addEventListener('online', () => {
  if (cloudSynced) cloud?.pushCloud(cloudFields(state));  // 復帰時に最新を一度送る
  else initCloudSync();
});

initCloudSync();

// ===== Service Worker 登録 =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // 登録失敗してもアプリ本体は動くので握りつぶす
    });
  });
}
