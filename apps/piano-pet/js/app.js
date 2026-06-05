import { createRouter, hashFromView, NAV_VIEWS } from './router.js';
import { loadState, saveState, cloudFields, mergeCloud, mergeCloudInitial, normalizeState } from './storage.js';
import { catStage, todayStr, xpProgress, applySession, recomputeState, dailyProgress, mergeSameDaySessions, DAILY_GOAL } from './game.js';
import { catMarkup, playHappy, playReaction, playCelebrate } from './cat.js';
import { isValidSession, collectSongs, stampsToSongs, songsToStamps, pastSongNames, songTotals } from './record-form.js';
import { songColor } from './song-color.js';
import { primaryItem, assignmentProgress, makeAssignment } from './assignment.js';
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
import { FOODS, foodById, canFeed, feedCat, foodSpent, affinity, affinityLevel, affinityRewards, bondCelebrateChance } from './feed.js';
import { isSoundOn, toggleSound, playSound, playStamp, rollCatVoice, playCatVoice, unlockAudio, suspendAudio, resumeAudio } from './sound.js';
import { badgesWithStatus, earnedCount, newlyEarned, BADGES } from './badges.js';
import { exportState, backupFilename, parseBackup, importErrorMessage, makeGateProblem, RESTORE_BACKUP_KEY } from './backup.js';
import { initErrorMonitoring } from './sentry.js';
import { initAnalytics, track } from './analytics.js';
import { isOnboarded, setOnboarded, ONBOARD_STEPS, isLastStep, nextStepIndex } from './onboarding.js';

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

// onSnapshot 購読の解除ハンドル。データ復元時に一時解除して、古いスナップショットによる
// 巻き戻し（インポート直後に他端末の旧データがエコーで降ってくる競合）を防ぐ（#140）。
let cloudUnsub = null;

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
      bond: affinityLevel(affinity(state)).level,   // なかよしレベルのエンブレム（#124）
    });
  }
  const nameEl = document.getElementById('petName');
  if (nameEl) nameEl.textContent = state.pet.name;

  renderStats();
  renderAssignment();
  renderSoundToggle();
}

// きょうの きょく（しゅくだい・#143）。宿題があればカードを表示し進捗を描く。
function renderAssignment() {
  const card = document.getElementById('assignmentCard');
  if (!card) return;
  const prog = assignmentProgress(state.sessions, state.assignment, todayStr());
  if (!prog) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const color = songColor(prog.name);
  card.style.setProperty('--hw-accent', color.tint);
  setText('assignmentBadge', prog.period === 'week' ? '🎀 こんしゅうの きょく' : '🎀 きょうの きょく');
  setText('assignmentName', prog.name);
  const swatch = document.getElementById('assignmentSwatch');
  if (swatch) swatch.style.background = color.fill;

  const fillEl = document.getElementById('assignmentFill');
  if (fillEl) fillEl.style.width = `${Math.round(prog.ratio * 100)}%`;
  const barEl = document.getElementById('assignmentBar');
  if (barEl) barEl.setAttribute('aria-valuenow', String(Math.round(prog.ratio * 100)));

  setText('assignmentMsg', prog.achieved
    ? 'やったね！しゅくだい たっせい！🎉'
    : `${prog.count} / ${prog.target} かい（あと ${prog.remaining}）`);
  card.classList.toggle('assignment-card--done', prog.achieved);
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

// なかよしレベルと次レベルへの進捗（#124）
function renderBond() {
  const a = affinityLevel(affinity(state));
  setText('statBondLevel', a.level);
  setText('statBondName', a.name);
  const fillEl = document.getElementById('statBondFill');
  if (fillEl) fillEl.style.width = `${Math.round(a.ratio * 100)}%`;
  const barEl = document.getElementById('statBondbar');
  if (barEl) barEl.setAttribute('aria-valuenow', String(Math.round(a.ratio * 100)));
  setText('statBondNext', a.isMax ? 'さいこうの なかよし！💖' : `つぎの レベルまで あと ${a.toNext}`);
}

// レベル・XPバー・コイン・ストリークの表示
function renderStats() {
  renderDailyGoal();
  renderBond();

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

// 曲別コレクション：曲ごとの色スウォッチ＋累計回数を多い順に並べる（#122）
function songCollectionMarkup(totals) {
  return totals
    .map((t) => {
      const c = songColor(t.name);
      return `<li class="song-collection__item">
        <span class="song-collection__swatch" style="background:${c.fill}" aria-hidden="true">🐾</span>
        <span class="song-collection__name">${escapeHtml(t.name)}</span>
        <span class="song-collection__count" style="color:${c.ink}">${t.count}かい</span>
      </li>`;
    })
    .join('');
}

function renderSongCollection() {
  const el = document.getElementById('songCollection');
  if (!el) return;
  const totals = songTotals(state.sessions);
  el.innerHTML = totals.length
    ? `<ul class="song-collection__list">${songCollectionMarkup(totals)}</ul>`
    : '<p class="history-empty">まだ きょくが ないよ。</p>';
}

export function renderHistory() {
  setText('historyStreakCurrent', state.streak.current);
  setText('historyStreakBest', state.streak.best);

  renderSongCollection();

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

// なかよし ごほうび解放リスト（#124）。affinity から解放状態を導出して表示する。
function bondRewardMarkup(r) {
  return `<li class="bond-reward${r.unlocked ? '' : ' is-locked'}">
    <span class="bond-reward__icon" aria-hidden="true">${r.unlocked ? '💝' : '🔒'}</span>
    <span class="bond-reward__body">
      <span class="bond-reward__name">Lv${r.level} ${r.name}</span>
      <span class="bond-reward__desc">${escapeHtml(r.reward)}</span>
    </span>
    <span class="bond-reward__req">${r.min}💖</span>
  </li>`;
}

export function renderShop() {
  setText('shopCoins', state.pet.coins);
  setText('feedAffinity', affinity(state));
  setText('feedBondName', affinityLevel(affinity(state)).name);
  const feedEl = document.getElementById('feedList');
  if (feedEl) feedEl.innerHTML = FOODS.map(feedCardMarkup).join('');
  const rewardsEl = document.getElementById('bondRewards');
  if (rewardsEl) rewardsEl.innerHTML = affinityRewards(affinity(state)).map(bondRewardMarkup).join('');
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
const stampModeEl = document.getElementById('stampMode');
const batchModeEl = document.getElementById('batchMode');
const batchRowsEl = document.getElementById('batchRows');
const batchTotalEl = document.getElementById('batchTotal');

// 新規曲入力欄(datalist)を過去の全曲で補完候補にする。チップは上位数曲のみ表示するため、
// 曲数が多い家庭でも手打ちせず履歴から選べるようにする（#77）。
function renderSongSuggestions() {
  if (!songSuggestEl) return;
  songSuggestEl.innerHTML = pastSongNames(state.sessions, Infinity)
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join('');
}

// 記録の入力方式：'stamp'（子が押すスタンプカード）/ 'batch'（親がまとめて入力）。#123
let recordMode = 'stamp';

// 押した順の曲名（stamps）と、選択中の曲・チップ候補。記録のたびに作り直す。
let stamps = [];
let selectedSong = null;
let chipNames = [];

function renderChips() {
  if (!songChipsEl) return;
  songChipsEl.innerHTML = chipNames
    .map((name) => {
      const selected = name === selectedSong;
      const c = songColor(name);
      // 選択中は曲の色で塗り、未選択は色スウォッチ（左の丸）で曲色を示す（#122）
      const style = selected
        ? `style="background:${c.fill};border-color:${c.fill}"`
        : `style="--song-fill:${c.fill}"`;
      return `<button type="button" class="song-chip${selected ? ' is-selected' : ''}" role="option" aria-selected="${selected}" data-song="${escapeHtml(name)}" ${style}>${escapeHtml(name)}</button>`;
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

// 押されたマスを曲の色で塗るインラインスタイル（淡い背景＋濃い枠線）。
function stampCellStyle(name) {
  const c = songColor(name);
  return `background:${c.tint};border-color:${c.fill}`;
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
    // 押したマスは、その押下時に選ばれていた曲の色で塗る（曲ごとに色が変わる・#122）
    const style = isFilled ? ` style="${stampCellStyle(stamps[i])}"` : '';
    html += `<span class="stamp-cell${isFilled ? ' is-filled' : ''}${isGoal ? ' is-goal' : ''}"${style} aria-hidden="true">${isFilled ? '🐾' : ''}</span>`;
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
  // 押したマスのindexでドレミ…と音程が上がり、目標マスは高いドに解決する(#139)
  playStamp(stamps.length - 1, state, DAILY_GOAL);
  if (reachedGoal) playSound('levelup', state);
}

function undoStamp() {
  if (!stamps.length) return;
  stamps.pop();
  renderStampCard();
}

// ===== まとめモード（親の後追い入力・#123） =====
// 1行 = { name, count }。曲名は datalist で過去曲を補完、回数はステッパーで増減。

// DOM の各行から現在の入力値を読み取る（state の正本は常に DOM 側）。
function readBatchRows() {
  if (!batchRowsEl) return [];
  return [...batchRowsEl.querySelectorAll('.batch-row')].map((el) => ({
    name: el.querySelector('.batch-row__name')?.value ?? '',
    count: Number(el.querySelector('.batch-row__count')?.value) || 0,
  }));
}

function batchRowMarkup(row) {
  const name = escapeHtml(row?.name ?? '');
  const count = Math.max(0, Math.floor(Number(row?.count)) || 0);
  return `<div class="batch-row">
    <input type="text" class="field-input batch-row__name" list="songSuggestions" placeholder="きょくめい" aria-label="きょくめい" maxlength="40" autocomplete="off" value="${name}">
    <div class="stepper">
      <button type="button" class="stepper__btn" data-step="-1" aria-label="かいすうを へらす">−</button>
      <input type="number" class="stepper__value batch-row__count" min="0" max="99" inputmode="numeric" aria-label="かいすう" value="${count}">
      <button type="button" class="stepper__btn" data-step="1" aria-label="かいすうを ふやす">＋</button>
    </div>
    <button type="button" class="batch-row__del" aria-label="この ぎょうを けす">✕</button>
  </div>`;
}

// rows（{name,count} 配列）から行UIを描き直す。空なら1行用意する。
function renderBatchRows(rows) {
  if (!batchRowsEl) return;
  const list = rows && rows.length ? rows : [{ name: '', count: 1 }];
  batchRowsEl.innerHTML = list.map(batchRowMarkup).join('');
  updateBatchTotal();
}

function updateBatchTotal() {
  if (!batchTotalEl) return;
  const { totalCount } = collectSongs(readBatchRows());
  batchTotalEl.textContent = String(totalCount);
  if (recordErrorEl && totalCount > 0) recordErrorEl.hidden = true;
}

function addBatchRow() {
  renderBatchRows([...readBatchRows(), { name: '', count: 1 }]);
}

// 記録方式を切り替える。入力途中の内容は曲×回数として相互変換し取りこぼさない。
function switchRecordMode(mode) {
  if (mode === recordMode) return;
  if (mode === 'batch') {
    // スタンプ → まとめ：押した順スタンプを曲ごとに集約して行へ
    const { songs } = stampsToSongs(stamps);
    renderBatchRows(songs);
  } else {
    // まとめ → スタンプ：行を曲ごとに集約してスタンプ列へ展開
    const { songs } = collectSongs(readBatchRows());
    stamps = songsToStamps(songs);
    chipNames = [...new Set(songs.map((s) => s.name)),
      ...pastSongNames(state.sessions).filter((n) => !songs.some((s) => s.name === n))];
    selectedSong = songs.length ? songs[songs.length - 1].name : (chipNames[0] ?? null);
    if (stampHintEl) stampHintEl.hidden = true;
    renderChips();
    renderStampCard();
  }
  recordMode = mode;
  applyRecordModeUI();
}

// モード表示（パネルの出し分け・タブの選択状態・エラー文言）を recordMode に同期。
function applyRecordModeUI() {
  const isBatch = recordMode === 'batch';
  if (stampModeEl) stampModeEl.hidden = isBatch;
  if (batchModeEl) batchModeEl.hidden = !isBatch;
  for (const btn of document.querySelectorAll('.record-mode__btn')) {
    const active = btn.dataset.mode === recordMode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  }
  if (recordErrorEl) {
    recordErrorEl.textContent = isBatch ? '1かい いじょう にゅうりょくしてね' : '1かい いじょう おしてね';
  }
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
  recordMode = 'stamp';
  if (recordDateEl) recordDateEl.value = todayStr();
  stamps = [];
  chipNames = pastSongNames(state.sessions);
  selectedSong = chipNames[0] ?? null;
  if (newSongInputEl) newSongInputEl.value = '';
  if (stampHintEl) stampHintEl.hidden = true;
  renderChips();
  renderSongSuggestions();
  renderStampCard();
  renderBatchRows([]);
  applyRecordModeUI();
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

// 連続日数の節目（このどれかに到達したら特別演出）。日常のお祝いと差をつける（#81）。
const STREAK_CELEBRATIONS = new Set([3, 7, 14, 30, 50, 100]);

// 記録直後の猫の演出を出し分ける。節目（レベルアップ／新バッジ／連続日数の節目）は
// 特別演出 playCelebrate、それ以外の通常記録は日常のお祝い playHappy（ランダム）。
function celebrateRecord({ leveled, badgeCount, streakCurrent, assignmentAchieved }) {
  const svg = document.querySelector('#catStage svg');
  const milestone = leveled || badgeCount > 0 || STREAK_CELEBRATIONS.has(streakCurrent) || assignmentAchieved;
  if (milestone) playCelebrate(svg);
  else playHappy(svg);
}

// 宿題が「未達成→達成」に切り替わったか（記録適用前後の進捗を比較・#143）。
// sessions を唯一の正とする派生判定なので、追加のフラグを持たずに再演出を防げる
// （達成済みの日に追記しても prev が既に達成なので false）。
function assignmentJustAchieved(prevSessions, nextState, today) {
  const before = assignmentProgress(prevSessions, state.assignment, today)?.achieved ?? false;
  const after = assignmentProgress(nextState.sessions, nextState.assignment, today);
  return !before && !!after?.achieved ? after.name : null;
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

// きょうの きょく（しゅくだい）達成のポップアップ・#143
function showAssignmentPopup(songName) {
  const popup = document.getElementById('assignmentPopup');
  if (!popup) return;
  setText('assignmentPopupSong', songName);
  popup.hidden = false;
  void popup.getBoundingClientRect();
  popup.classList.add('coin-popup--show');
  playSound('levelup', state);
  clearTimeout(showAssignmentPopup._t);
  showAssignmentPopup._t = setTimeout(() => {
    popup.classList.remove('coin-popup--show');
    popup.addEventListener('transitionend', () => { popup.hidden = true; }, { once: true });
  }, 2400);
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
  const { songs, totalCount } = recordMode === 'batch'
    ? collectSongs(readBatchRows())
    : stampsToSongs(stamps);

  if (!isValidSession({ totalCount })) {
    if (recordErrorEl) recordErrorEl.hidden = false;
    return;
  }

  // 宿題の達成遷移を判定するため、記録適用前の sessions を控える（#143）
  const prevSessions = state.sessions;
  const today = todayStr();

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
    cloud?.flushCloud();            // 記録確定はバッチ境界。debounce を待たず即送信（#146）
    track('practice_recorded', { totalCount: mergedCount }); // 回数のみ・曲名は送らない
    router.go('home');
    const hwSong = assignmentJustAchieved(prevSessions, newState, today);
    celebrateRecord({ leveled: newState.pet.level > prevLevel, badgeCount: gainedBadges.length, streakCurrent: newState.streak.current, assignmentAchieved: !!hwSong });
    showCoinPopup({ coins: Math.max(0, newState.pet.coins - prevCoins), leveled: newState.pet.level > prevLevel, newLevel: newState.pet.level });
    playSound('record', state);
    if (newState.pet.level > prevLevel) playSound('levelup', state);
    let nextDelay = 2200;
    if (gainedBadges.length) { setTimeout(() => showBadgePopup(gainedBadges), nextDelay); nextDelay += 2200; }
    if (hwSong) setTimeout(() => showAssignmentPopup(hwSong), nextDelay);
    resetRecordForm();
    return;
  }

  const prevBadges = state.badges;
  const { state: newState, rewards } = applySession(state, { date, songs, totalCount });
  const gainedBadges = newlyEarned(prevBadges, newState.badges);
  commitState(newState);          // 保存 + ホーム再描画
  cloud?.flushCloud();            // 記録確定はバッチ境界。debounce を待たず即送信（#146）
  track('practice_recorded', { totalCount }); // 回数のみ・曲名は送らない
  router.go('home');              // ホームへ遷移
  // 節目（レベルアップ／新バッジ／連続日数の節目／宿題達成）は特別演出、通常はランダムなお祝い（#81/#143）
  const hwSong = assignmentJustAchieved(prevSessions, newState, today);
  celebrateRecord({ leveled: rewards.leveled, badgeCount: gainedBadges.length, streakCurrent: newState.streak.current, assignmentAchieved: !!hwSong });
  showCoinPopup(rewards);         // 獲得コインのポップアップ
  // 効果音：記録完了 →（レベルアップ時のみ）レベルアップ音
  playSound('record', state);
  if (rewards.leveled) playSound('levelup', state);
  // コインポップアップの後に、お休み券→新規バッジ→宿題達成の順で表示
  let nextDelay = 2200;
  if (rewards.frozeDays > 0) {
    setTimeout(showFreezePopup, nextDelay);
    nextDelay += 2200;
  }
  if (gainedBadges.length) { setTimeout(() => showBadgePopup(gainedBadges), nextDelay); nextDelay += 2200; }
  if (hwSong) setTimeout(() => showAssignmentPopup(hwSong), nextDelay);
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

// ===== きろく方式の切替＋まとめモードの行操作（#123） =====
document.querySelector('.record-mode')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.record-mode__btn');
  if (btn) switchRecordMode(btn.dataset.mode);
});
document.getElementById('addBatchRowBtn')?.addEventListener('click', addBatchRow);
batchRowsEl?.addEventListener('click', (e) => {
  const row = e.target.closest('.batch-row');
  if (!row) return;
  if (e.target.closest('.batch-row__del')) {
    const rows = readBatchRows().filter((_, i) => i !== [...batchRowsEl.children].indexOf(row));
    renderBatchRows(rows);
    return;
  }
  const stepBtn = e.target.closest('.stepper__btn');
  if (stepBtn) {
    const countEl = row.querySelector('.batch-row__count');
    const next = Math.max(0, (Number(countEl.value) || 0) + Number(stepBtn.dataset.step));
    countEl.value = String(next);
    updateBatchTotal();
  }
});
batchRowsEl?.addEventListener('input', updateBatchTotal);

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
// たまに威嚇（hiss）したときは、喜び演出（ハート・しっぽふり）は出さない。
function petCat() {
  unlockAudio();                                       // ユーザー操作で AudioContext を解錠
  const voice = rollCatVoice();                        // なで反応を抽選（音設定に依存しない）
  playCatVoice(state, voice);                          // 抽選結果の鳴き声を再生（OFF時は無音）
  if (voice === 'hiss') return;                        // 威嚇のときは演出なし（ミュートでも一貫）
  const svg = document.querySelector('#catStage svg');
  // なかよしレベルが高いと、たまに「とくべつな えんしゅつ」が出る（#124 専用演出）
  if (Math.random() < bondCelebrateChance(affinityLevel(affinity(state)).level)) {
    playCelebrate(svg);
  } else {
    playReaction(svg);
  }
}
document.getElementById('catStage')?.addEventListener('click', petCat);

// ===== サウンドON/OFFトグル =====
document.getElementById('soundToggle')?.addEventListener('click', () => {
  unlockAudio();                    // ユーザー操作で AudioContext を解錠
  commitState(toggleSound(state));  // 設定を反転して保存（renderHome でボタン更新）
  if (isSoundOn(state)) playSound('coin', state);  // ONにした合図に短く鳴らす
});

// ===== せってい：データのバックアップ/復元（#140） =====
const settingsOverlayEl = document.getElementById('settingsOverlay');
const settingsGateEl = document.getElementById('settingsGate');
const settingsMenuEl = document.getElementById('settingsMenu');
const gateAnswerEl = document.getElementById('gateAnswer');
const gateErrorEl = document.getElementById('gateError');
const importFileEl = document.getElementById('importFile');
const importStatusEl = document.getElementById('importStatus');

// ゲートの正解（openSettings のたびに作り直す）。
let gateExpected = null;

function openSettings() {
  const p = makeGateProblem();
  gateExpected = p.answer;
  setText('gateA', p.a);
  setText('gateB', p.b);
  if (gateAnswerEl) gateAnswerEl.value = '';
  if (gateErrorEl) gateErrorEl.hidden = true;
  if (importStatusEl) importStatusEl.hidden = true;
  if (settingsGateEl) settingsGateEl.hidden = false;   // 毎回ゲートから
  if (settingsMenuEl) settingsMenuEl.hidden = true;
  if (settingsOverlayEl) settingsOverlayEl.hidden = false;
  gateAnswerEl?.focus();
}

function closeSettings() {
  if (settingsOverlayEl) settingsOverlayEl.hidden = true;
}

// 親ゲートの解答チェック。正解でメニューを開き、誤りなら再入力させる。
function submitGate() {
  if (Number(gateAnswerEl?.value) === gateExpected) {
    if (settingsGateEl) settingsGateEl.hidden = true;
    if (settingsMenuEl) settingsMenuEl.hidden = false;
    loadHwInputs();                       // 宿題の現在値をフォームに反映（#143）
  } else if (gateErrorEl) {
    gateErrorEl.hidden = false;
    if (gateAnswerEl) gateAnswerEl.value = '';
    gateAnswerEl?.focus();
  }
}

function showImportStatus(msg, isError) {
  if (!importStatusEl) return;
  importStatusEl.textContent = msg;
  importStatusEl.hidden = false;
  importStatusEl.classList.toggle('settings-menu__note--error', !!isError);
}

// 現行 state を JSON 化して a[download] でローカル保存（無害なので確認不要）。
function downloadBackup() {
  const json = exportState(state);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  showImportStatus('ファイルを ほぞんしたよ！', false);
}

// 取り込み確定：①直前データを退避 ②クラウド購読を解除 ③ローカル保存
// ④クラウドへ反映完了を待つ ⑤リロード。古いスナップショットの巻き戻しを断つ（#140 設計レビュー C/D）。
async function applyImportedState(imported) {
  try {
    const cur = localStorage.getItem('piano-pet');
    if (cur) localStorage.setItem(RESTORE_BACKUP_KEY, cur);   // 誤読込からの復旧用に退避
  } catch { /* 退避失敗は致命的でないので無視 */ }
  if (cloudUnsub) {
    try { cloudUnsub(); } catch { /* 解除失敗は無視 */ }
    cloudUnsub = null;
  }
  state = imported;
  saveState(state);
  if (cloud) {
    try { await cloud.pushCloud(cloudFields(state)); } catch { /* push 失敗時もローカルは取り込み済み */ }
  }
  window.location.reload();   // クリーンに再起動（状態変数の不整合・古い購読を一掃）
}

// 選択ファイルを読んで検証。OK なら確認のうえ復元、NG なら理由をひらがなで表示。
function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const res = parseBackup(String(reader.result));
    if (!res.ok) {
      showImportStatus(importErrorMessage(res.reason), true);
      return;
    }
    if (!window.confirm('いまの データは きえて、ファイルの データに なります。よろしいですか？')) return;
    applyImportedState(res.state);
  };
  reader.onerror = () => showImportStatus(importErrorMessage('parse'), true);
  reader.readAsText(file);
}

// ===== せってい：きょうの きょく（しゅくだい）設定・#143 =====
const hwNameEl = document.getElementById('hwName');
const hwTargetEl = document.getElementById('hwTarget');
const hwStatusEl = document.getElementById('hwStatus');
const hwPeriodDayBtn = document.getElementById('hwPeriodDay');
const hwPeriodWeekBtn = document.getElementById('hwPeriodWeek');
let hwPeriod = 'day';

// 期間トグル（きょう / こんしゅう）の見た目と状態を切り替える。
function setHwPeriod(period) {
  hwPeriod = period === 'week' ? 'week' : 'day';
  const isWeek = hwPeriod === 'week';
  hwPeriodDayBtn?.classList.toggle('is-active', !isWeek);
  hwPeriodWeekBtn?.classList.toggle('is-active', isWeek);
  hwPeriodDayBtn?.setAttribute('aria-pressed', String(!isWeek));
  hwPeriodWeekBtn?.setAttribute('aria-pressed', String(isWeek));
}

// 現在の state.assignment をフォームへ反映（ゲート通過時に呼ぶ）。
function loadHwInputs() {
  const item = primaryItem(state.assignment);
  if (hwNameEl) hwNameEl.value = item ? item.name : '';
  if (hwTargetEl) hwTargetEl.value = item ? String(item.target) : '5';
  setHwPeriod(state.assignment?.period ?? 'day');
  if (hwStatusEl) hwStatusEl.hidden = true;
}

function showHwStatus(msg) {
  if (!hwStatusEl) return;
  hwStatusEl.textContent = msg;
  hwStatusEl.hidden = false;
}

// 宿題を保存。曲名が空なら保存しない（クリアは「けす」ボタン）。
function saveHomework() {
  const name = String(hwNameEl?.value ?? '').trim();
  if (!name) { showHwStatus('きょくめいを いれてね'); return; }
  const assignment = makeAssignment({ name, target: hwTargetEl?.value, period: hwPeriod });
  commitState({ ...state, assignment });
  cloud?.flushCloud();
  showHwStatus('きめたよ！ホームに でるよ 🎀');
}

// 宿題をクリア（items:[] のトゥームストーンで他端末へも伝播）。
function clearHomework() {
  commitState({ ...state, assignment: makeAssignment({ name: '', period: hwPeriod }) });
  cloud?.flushCloud();
  if (hwNameEl) hwNameEl.value = '';
  showHwStatus('しゅくだいを けしたよ');
}

hwPeriodDayBtn?.addEventListener('click', () => setHwPeriod('day'));
hwPeriodWeekBtn?.addEventListener('click', () => setHwPeriod('week'));
document.getElementById('hwSaveBtn')?.addEventListener('click', saveHomework);
document.getElementById('hwClearBtn')?.addEventListener('click', clearHomework);

document.getElementById('settingsToggle')?.addEventListener('click', openSettings);
settingsOverlayEl?.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-settings"]')) closeSettings();
});
document.getElementById('gateSubmit')?.addEventListener('click', submitGate);
gateAnswerEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  submitGate();
});
document.getElementById('exportBtn')?.addEventListener('click', downloadBackup);
document.getElementById('importBtn')?.addEventListener('click', () => importFileEl?.click());
importFileEl?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) handleImportFile(file);
  e.target.value = '';   // 同じファイルを連続選択しても change が発火するように
});

// ===== 初回オンボーディング（猫の吹き出し紙芝居・#141） =====
// 何をするアプリかを猫の吹き出し3画面で案内する。スキップ可・一度見たら出さない。
const onboardingEl = document.getElementById('onboardingOverlay');
const onboardingNextEl = document.getElementById('onboardingNext');
let onboardStep = 0;

// 現在のステップ番号に合わせて吹き出し・進捗ドット・ボタン文言を描き直す。
function renderOnboardingStep() {
  const step = ONBOARD_STEPS[onboardStep];
  if (!step) return;
  setText('onboardingEmoji', step.emoji);
  setText('onboardingTitle', step.title);
  setText('onboardingBody', step.body);
  const dotsEl = document.getElementById('onboardingDots');
  if (dotsEl) {
    dotsEl.innerHTML = ONBOARD_STEPS
      .map((_, i) => `<span class="onboarding__dot${i === onboardStep ? ' is-active' : ''}"></span>`)
      .join('');
  }
  if (onboardingNextEl) onboardingNextEl.textContent = isLastStep(onboardStep) ? 'はじめる！' : 'つぎへ';
}

function showOnboarding() {
  if (!onboardingEl) return;
  onboardStep = 0;
  // 既存の猫SVGを流用（新規アセットなし）。案内中はうれしそうな若猫を出す。
  const catEl = document.getElementById('onboardingCat');
  if (catEl) catEl.innerHTML = catMarkup({ stage: 'young', mood: 'idle', name: state.pet.name });
  renderOnboardingStep();
  onboardingEl.hidden = false;
}

// 完了（スキップ／はじめる いずれも）：フラグを立てて二度と出さない。
function finishOnboarding() {
  setOnboarded();
  if (onboardingEl) onboardingEl.hidden = true;
}

onboardingNextEl?.addEventListener('click', () => {
  if (isLastStep(onboardStep)) {
    finishOnboarding();
    return;
  }
  onboardStep = nextStepIndex(onboardStep);
  renderOnboardingStep();
});
document.getElementById('onboardingSkip')?.addEventListener('click', finishOnboarding);

window.addEventListener('hashchange', () => router.syncFromHash(window.location.hash));

// 初期表示
renderHome();
router.syncFromHash(window.location.hash);

// 初回起動なら使い方の案内を出す（renderHome 後に重ねる）
if (!isOnboarded()) showOnboarding();

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
    reconcileInitialCloud(cloudData);       // 初回はローカル優先マージ（起動直後の記録を消さない）
  } else if (hasLocalData(state)) {
    await cloud.pushCloud(cloudFields(state));  // 初回: 既存のローカルデータを移行
  }
  cloudUnsub = cloud.subscribeCloud(applyRemoteState);   // 以降は他端末の変更をリアルタイム反映（ハンドルは復元時の解除用に保持）
}

// 初回 fetchCloud の取り込み（#142）。realtime onSnapshot の cloud-wins（applyRemoteState）と違い、
// 起動直後（idle 同期完了前）にローカルで記録した内容を cloud で上書きしないよう、
// mergeCloudInitial でフィールドごとにローカル優先マージし、sessions から全導出値を再計算する。
function reconcileInitialCloud(cloudData) {
  const merged = mergeCloudInitial(state, cloudData);
  const reconciled = recomputeState(merged, spentTotal(merged));
  const reconciledCloud = JSON.stringify(cloudFields(reconciled));

  if (reconciledCloud !== JSON.stringify(cloudFields(state))) {
    state = reconciled;
    saveState(state);                       // ローカルキャッシュも最新に
    renderHome();
    if (router.current === 'history') renderHistory();
    else if (router.current === 'shop') renderShop();
    else if (router.current === 'badges') renderBadges();
  }
  // ローカルだけが持っていた記録（起動直後に記録した分など）でクラウドが古ければ確定保存する。
  if (reconciledCloud !== JSON.stringify(cloudFields(normalizeState(cloudData)))) {
    cloud?.pushCloud(cloudFields(state));
  }
}

// オフライン起動後にネットワークが復帰したら同期を立ち上げ直す。
window.addEventListener('online', () => {
  if (cloudSynced) cloud?.pushCloud(cloudFields(state));  // 復帰時に最新を一度送る
  else initCloudSync();
});

// タブの表示状態に応じて省電力・取りこぼし防止を行う（#146）。
//   - 非アクティブ化: 効果音用 AudioContext を suspend（音声HWを休ませバッテリ節約）し、
//     保留中のクラウド書き込みを flush（バックグラウンド/終了で消えないよう確定送信）。
//   - 復帰: AudioContext を resume（次の効果音に備える）。
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    suspendAudio();
    cloud?.flushCloud();
  } else {
    resumeAudio();
  }
});
// 離脱直前（タブ閉じ・遷移）にも保留中の書き込みを確定する。pagehide は
// visibilitychange より確実に発火する端末があるため併用する。
window.addEventListener('pagehide', () => cloud?.flushCloud());

// 初回のクラウド同期はブラウザのアイドル時間まで遅延し、初回描画・操作を妨げない（#142）。
// renderHome は既に localStorage から同期描画済み。Firebase SDK の動的取得・初期化はここで初めて走る。
// requestIdleCallback 非対応（一部 Safari 等）は短い setTimeout でフォールバック。
if ('requestIdleCallback' in window) {
  requestIdleCallback(() => initCloudSync(), { timeout: 2000 });
} else {
  setTimeout(() => initCloudSync(), 200);
}

// ===== Service Worker 登録 =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // 登録失敗してもアプリ本体は動くので握りつぶす
    });
  });
}
