import { createRouter, hashFromView, NAV_VIEWS } from './router.js';
import { escapeHtml } from './html.js';
import { loadState, saveState, cloudFields, mergeCloud, mergeCloudInitial, normalizeState, activeStorageKey } from './storage.js';
import {
  getAccounts, getActiveAccountId, setActiveAccount,
  getCloudDocId, setCloudDocId, generateCloudDocId, isValidCloudDocId, legacyCloudDocIdFor,
} from './account.js';
import { todayStr, xpProgress, applySession, recomputeState, dailyProgress, crossedDailyGoal, mergeSameDaySessions, DAILY_GOAL, clampDailyGoal, rollDailyBonus, checkBadges } from './game.js';
import { catMarkup, playHappy, playReaction, playCelebrate, playHiss, preloadTier, prefetchNextTier, tierFromBond, catImageSrc, CAT_STYLES, normalizeStyle, itemLayer, isSceneItem } from './cat-image.js';
import { isValidSession, collectSongs, stampsToSongs, songsToStamps, combineSongs, pastSongNames, songTotals, isSongMaster, PRAISE_STAMPS, normalizePraise, TEMPO_STAMPS, normalizeTempo } from './record-form.js';
import { songColor, assignSongColors } from './song-color.js';
import { CHILD_AVATARS, normalizeChildAvatar, avatarEmoji, normalizeChildName } from './child-profile.js';
import {
  weeklyTotals,
  weeklyChartModel,
  weeklySummary,
  formatDateJa,
  monthGrid,
  monthLabel,
  shiftMonth,
} from './history.js';
import {
  SHOP_ITEMS,
  isOwned,
  isEquipped,
  isPlaced,
  canBuy,
  isUnlocked,
  buyItem,
  itemById,
  toggleEquip,
  togglePlace,
  spentCoins,
} from './shop.js';
import { FOODS, foodById, canFeed, feedCat, foodSpent, affinity, affinityLevel, affinityRewards, bondCelebrateChance, recordClipChance } from './feed.js';
import { isSoundOn, toggleSound, playSound, playStamp, rollCatVoice, playCatVoice, unlockAudio, suspendAudio, resumeAudio } from './sound.js';
import { badgesWithStatus, earnedCount, newlyEarned, BADGES } from './badges.js';
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

// 装備・配置していないアイテムの座標を itemLayout から除く（#168/#226 ゴーストデータ防止）。
// itemLayout は装着衣装と置物（#226）で共用するため、装備中 or 配置中のIDだけ残す。
function cleanItemLayout(pet) {
  const layout = pet.itemLayout ?? {};
  const active = new Set([...(pet.equippedItems ?? []), ...(pet.placedItems ?? [])]);
  const cleaned = {};
  for (const id of Object.keys(layout)) {
    if (active.has(id)) cleaned[id] = layout[id];
  }
  return cleaned;
}

export function commitState(newState) {
  state = { ...newState, pet: { ...newState.pet, itemLayout: cleanItemLayout(newState.pet) } };
  saveState(state);                 // ローカルキャッシュ（オフライン用）
  if (cloud) cloud.pushCloudDebounced(() => cloudFields(state));  // クラウドへ反映（読み込み済みのときだけ）
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
    const bond = affinityLevel(affinity(state)).level;
    stageEl.innerHTML = catMarkup({
      mood: moodForState(state),
      equippedItems: state.pet.equippedItems,
      placedItems: state.pet.placedItems,            // 置物・小物系の配置（#226）
      name: state.pet.name,
      bond,                                          // なかよしレベルのエンブレム（#124）→ tier導出にも使う
      itemLayout: state.pet.itemLayout,              // 衣装・置物の自由配置（#168/#226）
      style: state.pet.catStyle,                     // 猫スタイル（#66）。未指定は tora
    });
    preloadTier(state.pet.catStyle, tierFromBond(bond));   // 選択中スタイルの現tierを先読み（演出時のガタつき防止）
    prefetchNextTier(state.pet.catStyle, affinity(state)); // 次tier境界の手前なら次の5枚を先読み
  }
  const nameEl = document.getElementById('petName');
  if (nameEl) nameEl.textContent = state.pet.name;

  renderChildAvatar();
  renderStats();
  renderSoundToggle();
  renderLayerPanel();   // きせかえ編集中だけ中身を描き直す（非表示なら即 return・#270）
}

// ヘッダ隅のこどもアバター（#121）。home/history の両ヘッダに同じ内容を反映する。
function renderChildAvatar() {
  const emoji = avatarEmoji(state.pet.childAvatar);
  const name = normalizeChildName(state.pet.childName);
  for (const el of document.querySelectorAll('.child-avatar')) {
    const face = el.querySelector('.child-avatar__face');
    const label = el.querySelector('.child-avatar__name');
    if (face) face.textContent = emoji;
    if (label) label.textContent = name;
  }
}

// 既知の曲すべてに衝突回避込みで色を割り当てた Map を返す（#165）。
// 並びは累計回数順（songTotals）で決定的。extraNames に未保存の曲名（新規入力・
// チップ候補）を渡すと末尾に足して色を割り当てる。全画面でこのマップを基準にすれば
// 同じ曲が同じ色になり、近接ハッシュによる色かぶりも避けられる。
function buildSongColors(extraNames = []) {
  const ordered = songTotals(state.sessions).map((t) => t.name);
  for (const n of extraNames) {
    const name = String(n ?? '').trim();
    if (name && !ordered.includes(name)) ordered.push(name);
  }
  return assignSongColors(ordered);
}

// 記録フォーム（チップ／スタンプ）で使う色マップ。候補曲（chipNames）を含めて
// 1つのマップを共有し、チップとスタンプで同じ曲が同じ色になるようにする。
function formSongColors() {
  return buildSongColors(chipNames);
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

// 親が設定した1日の目標回数（#238）。未設定の旧データは既定10（normalizeState 補完済み）。
function currentGoal() {
  return clampDailyGoal(state.pet?.dailyGoal ?? DAILY_GOAL);
}

// 今日の目標（○/目標回）の進捗表示
function renderDailyGoal() {
  const target = currentGoal();
  const goal = dailyProgress(state.sessions, todayStr(), target);
  setText('statGoalCount', goal.count);
  setText('statGoalTarget', target);              // 分母（○/N かい）を可変目標に追従

  const fillEl = document.getElementById('statGoalFill');
  if (fillEl) fillEl.style.width = `${Math.round(goal.ratio * 100)}%`;
  const barEl = document.getElementById('statGoalbar');
  if (barEl) {
    barEl.setAttribute('aria-valuemax', String(target));
    barEl.setAttribute('aria-valuenow', String(Math.min(goal.count, goal.goal)));
  }

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

// 記録カードのワンタップ・スタンプ行（はなまる #145 / 練習の質メモ #239）。
// 同型（Session の単一フィールドに id を1つ・再タップで解除）なので設定駆動で共通化する。
const SESSION_MARKS = {
  praise: { stamps: PRAISE_STAMPS, normalize: normalizePraise, cls: 'praise-stamp', row: 'praise-row', label: 'はなまるスタンプ' },
  tempo: { stamps: TEMPO_STAMPS, normalize: normalizeTempo, cls: 'tempo-stamp', row: 'tempo-row', label: 'れんしゅうの ようす' },
};

// スタンプ行のマークアップ：選択中のものを強調。タップで付与／同じものを再タップで解除。
function markRowMarkup(kind, session, index) {
  const m = SESSION_MARKS[kind];
  const current = m.normalize(session[kind]);
  const buttons = m.stamps.map((p) => {
    const on = p.id === current;
    return `<button type="button" class="${m.cls}${on ? ` ${m.cls}--on` : ''}"` +
      ` data-action="set-mark" data-mark="${kind}" data-index="${index}" data-id="${p.id}"` +
      ` aria-pressed="${on}" title="${p.label}" aria-label="${p.label}">${p.emoji}</button>`;
  }).join('');
  return `<div class="${m.row}" role="group" aria-label="${m.label}">${buttons}</div>`;
}

function historyCardMarkup(session, index) {
  // 同日同曲が複数行に分かれた既存データも1行に合算して表示する（#186）
  const songs = combineSongs(session.songs)
    .map((s) => `<li><span class="song-title">${escapeHtml(s.name)}</span>` +
      `<span class="song-times">${Number(s.count) || 0}かい</span></li>`)
    .join('');
  return `<div class="history-card">
    <div class="history-card__date">
      <span class="history-card__day">${formatDateJa(session.date)}</span>
      <span class="history-card__total">ごうけい <b>${Number(session.totalCount) || 0}</b> かい</span>
    </div>
    <ul class="history-songs">${songs}</ul>
    ${markRowMarkup('praise', session, index)}
    ${markRowMarkup('tempo', session, index)}
    <div class="history-card__actions">
      <button type="button" class="history-action" data-action="edit-session" data-index="${index}" aria-label="この きろくを なおす">✏️ なおす</button>
      <button type="button" class="history-action history-action--del" data-action="delete-session" data-index="${index}" aria-label="この きろくを けす">🗑️ けす</button>
    </div>
  </div>`;
}

// 曲別コレクション：曲ごとの色スウォッチ＋累計回数を多い順に並べる（#122）
function songCollectionMarkup(totals) {
  const colors = buildSongColors();
  return totals
    .map((t) => {
      const c = colors.get(t.name) ?? songColor(t.name);
      const crown = isSongMaster(t.count)
        ? '<span class="song-collection__crown" title="マスター" aria-label="マスター">👑</span>'
        : '';
      return `<li class="song-collection__item">
        <span class="song-collection__swatch" style="background:${c.fill}" aria-hidden="true">🐾</span>
        <span class="song-collection__name">${escapeHtml(t.name)}</span>
        ${crown}
        <span class="song-collection__count" style="color:${c.ink}">${t.count}かい</span>
      </li>`;
    })
    .join('');
}

// 表示中の月（練習カレンダー・#236）。初期値は今月。前月/翌月ボタンで移動する。
let calYear = null;
let calMonth = null;

function ensureCalMonth() {
  if (calYear == null || calMonth == null) {
    const [y, m] = todayStr().split('-');
    calYear = Number(y);
    calMonth = Number(m);
  }
}

// 月間カレンダー（草式ヒートマップ・#236）。sessions 導出のみ・目標(#238)に濃淡が追従。
function renderCalendar() {
  const grid = document.getElementById('calGrid');
  if (!grid) return;
  ensureCalMonth();
  setText('calTitle', monthLabel(calYear, calMonth));
  const weeks = monthGrid(calYear, calMonth, state.sessions, { today: todayStr(), goal: currentGoal() });
  grid.innerHTML = weeks.map((week) => week.map((cell) => {
    if (!cell) return '<span class="cal-cell cal-cell--pad" aria-hidden="true"></span>';
    const cls = `cal-cell${cell.isToday ? ' cal-cell--today' : ''}${cell.isFuture ? ' cal-cell--future' : ''}`;
    const title = `${calMonth}/${cell.day}：${cell.count}かい`;
    return `<span class="${cls}" data-level="${cell.level}" title="${title}"><span class="cal-cell__day">${cell.day}</span></span>`;
  }).join('')).join('');
}

function moveCalendar(delta) {
  ensureCalMonth();
  const next = shiftMonth(calYear, calMonth, delta);
  calYear = next.year;
  calMonth = next.month;
  renderCalendar();
}

function renderSongCollection() {
  const el = document.getElementById('songCollection');
  if (!el) return;
  const totals = songTotals(state.sessions);
  el.innerHTML = totals.length
    ? `<ul class="song-collection__list">${songCollectionMarkup(totals)}</ul>`
    : '<p class="history-empty">まだ きょくが ないよ。</p>';
}

// 今週のふりかえりカード（#144）：今週の回数・きょく数・日数を集計して表示。
function renderReviewCard() {
  const sum = weeklySummary(state.sessions, todayStr());
  setText('reviewCount', sum.count);
  setText('reviewSongs', sum.songCount);
  setText('reviewDays', sum.dayCount);
}

export function renderHistory() {
  setText('historyStreakCurrent', state.streak.current);
  setText('historyStreakBest', state.streak.best);

  renderChildAvatar();
  renderReviewCard();
  renderCalendar();
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
  // 置物（#226）は装備でなく「配置(placedItems)」。slotで判定し、ラベルと状態語を切り替える。
  const scene = item.slot === 'scene';
  const active = scene ? isPlaced(state, item.id) : isEquipped(state, item.id);

  // 未所持で「なかよしLv」未到達なら、見せるロック（#126）：非表示にせず目標として見せる。
  const locked = !owned && !isUnlocked(state, item.id);

  // 置物は配置トグル（togglePlace）、装着は装備トグル（toggleEquip）へ振り分ける。
  const action = scene ? 'place' : 'toggle';
  const onLabel = scene ? 'おく' : 'みにつける';
  const offLabel = scene ? 'しまう' : 'はずす';

  let btn;
  if (locked) {
    btn = `<button type="button" class="shop-btn shop-btn--locked" disabled>なかよしLv${item.unlockLevel}で あえる</button>`;
  } else if (!owned) {
    btn = canBuy(state, item.id)
      ? `<button type="button" class="shop-btn shop-btn--buy" data-action="buy" data-id="${item.id}">かう</button>`
      : `<button type="button" class="shop-btn shop-btn--locked" disabled>コインが たりない</button>`;
  } else if (active) {
    btn = `<button type="button" class="shop-btn shop-btn--unequip" data-action="${action}" data-id="${item.id}">${offLabel}</button>`;
  } else {
    btn = `<button type="button" class="shop-btn shop-btn--equip" data-action="${action}" data-id="${item.id}">${onLabel}</button>`;
  }

  const badge = active
    ? `<span class="shop-card__badge">${scene ? 'おうちに あるよ ✓' : 'みにつけてる ✓'}</span>`
    : (locked ? `<span class="shop-card__badge shop-card__badge--locked">🔒 なかよしLv${item.unlockLevel}</span>` : '');
  return `<div class="shop-card${active ? ' shop-card--equipped' : ''}${locked ? ' shop-card--locked' : ''}">
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
    if (view === 'record') primeCatVideo();   // 記録演出の動画モジュール＋クリップを先読み（#227・#284）
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
document.getElementById('calPrevBtn')?.addEventListener('click', () => moveCalendar(-1));  // 練習カレンダー 前月（#236）
document.getElementById('calNextBtn')?.addEventListener('click', () => moveCalendar(1));   // 練習カレンダー 翌月
document.getElementById('photoBtn')?.addEventListener('click', shareCatPhoto);             // 写真モード（#237）

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

// 当日のスタンプ下書きを退避する localStorage キー（#164）。ホームに戻って戻ってきても
// 同じカードを引き継ぐ。打鍵ごとの Firestore 同期はせず、ここに一時キャッシュする。
// アカウントごとに下書きを分離する（#182）。'data'（娘）は従来どおり 'piano-pet:stamp-draft'。
const STAMP_DRAFT_KEY = `${activeStorageKey()}:stamp-draft`;

// 現在の stamps を当日の下書きとして保存。編集中（既存セッションの修正）と、
// 日付欄が今日以外を指しているとき（#273）は、当日の下書きを汚さないよう保存しない。
function saveStampDraft() {
  if (editingIndex != null) return;
  if (recordDateEl && formDate() !== todayStr()) return;
  try {
    localStorage.setItem(STAMP_DRAFT_KEY, JSON.stringify({ date: todayStr(), stamps }));
  } catch { /* 保存できなくても致命的でないため無視 */ }
}

function clearStampDraft() {
  try { localStorage.removeItem(STAMP_DRAFT_KEY); } catch { /* 無視 */ }
}

// 当日のスタンプ下書きを読み出す。日付が変わっていれば破棄して [] を返す。
function loadStampDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(STAMP_DRAFT_KEY) ?? 'null');
    if (draft?.date !== todayStr() || !Array.isArray(draft.stamps)) {
      clearStampDraft();
      return [];
    }
    return draft.stamps.filter((s) => typeof s === 'string' && s.trim());
  } catch {
    return [];
  }
}

function renderChips() {
  if (!songChipsEl) return;
  const colors = formSongColors();
  songChipsEl.innerHTML = chipNames
    .map((name) => {
      const selected = name === selectedSong;
      const c = colors.get(name) ?? songColor(name);
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
function stampCellStyle(c) {
  return `background:${c.tint};border-color:${c.fill}`;
}

// スタンプカードを描画。最低「目標マス」ぶん、超過時は常に1マス余分に出して押し続けられるようにする。
function renderStampCard() {
  if (!stampCardEl) return;
  const goal = currentGoal();                 // 目標回数（#238・可変）に追従
  const colors = formSongColors();
  const filled = stamps.length;
  const cells = Math.max(goal, filled + 1);
  let html = '';
  for (let i = 0; i < cells; i += 1) {
    const isFilled = i < filled;
    const isGoal = i === goal - 1;
    // 押したマスは、その押下時に選ばれていた曲の色で塗る（曲ごとに色が変わる・#122）
    const style = isFilled ? ` style="${stampCellStyle(colors.get(stamps[i]) ?? songColor(stamps[i]))}"` : '';
    html += `<span class="stamp-cell${isFilled ? ' is-filled' : ''}${isGoal ? ' is-goal' : ''}"${style} aria-hidden="true">${isFilled ? '🐾' : ''}</span>`;
  }
  stampCardEl.innerHTML = html;
  stampCardEl.classList.toggle('is-complete', filled >= goal);
  setText('recordGoalTarget', goal);            // 記録画面の分母（○/目標こ）も追従
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
  const goal = currentGoal();
  const reachedGoal = stamps.length + 1 === goal;
  stamps.push(selectedSong);
  saveStampDraft();
  renderStampCard();
  // 押したマスのindexでドレミ…と音程が上がり、目標マスは高いドに解決する(#139・目標可変#238)
  playStamp(stamps.length - 1, state, goal);
  if (reachedGoal) playSound('levelup', state);
}

function undoStamp() {
  if (!stamps.length) return;
  stamps.pop();
  saveStampDraft();
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
    saveStampDraft();
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

// 入力欄が指す記録日。未来日は今日に丸める（時系列破壊防止・#260）。
function formDate() {
  const today = todayStr();
  const v = recordDateEl?.value || today;
  return v > today ? today : v;
}

// 当日の入力内容の復元元。記録確定後は当日セッションが正（#186）、未確定は下書き（#164）。
function todayStamps() {
  const todaySession = state.sessions.find((s) => s.date === todayStr());
  return todaySession ? songsToStamps(combineSongs(todaySession.songs)) : loadStampDraft();
}

// stamps に合わせて曲チップ・選択中の曲・カード・まとめ行を描き直す。
function syncRecordInputs() {
  const names = [...new Set(stamps)];
  chipNames = [...names, ...pastSongNames(state.sessions).filter((n) => !names.includes(n))];
  selectedSong = names[names.length - 1] ?? chipNames[0] ?? null;
  renderChips();
  renderStampCard();
  renderBatchRows(stampsToSongs(stamps).songs);
}

// 日付が変わったら、その日付が本来始まるべき内容へフォームを戻す（→ features.md #273）。
// 今日=当日セッション/下書きから復元、今日以外=空。持ち越すと当日ぶんが二重計上される。
function onRecordDateChange() {
  if (editingIndex != null) return;   // 編集中は対象セッションの内容が正
  stamps = formDate() === todayStr() ? todayStamps() : [];
  saveStampDraft();                   // 過去日は saveStampDraft 側のガードで no-op
  if (stampHintEl) stampHintEl.hidden = true;
  syncRecordInputs();
}

function resetRecordForm() {
  editingIndex = null;
  setRecordMode(false);
  recordMode = 'stamp';
  if (recordDateEl) {
    recordDateEl.value = todayStr();
    recordDateEl.max = todayStr();   // 未来日はピッカーで選ばせない（時系列破壊防止・#260）
  }
  stamps = todayStamps();
  saveStampDraft();
  if (newSongInputEl) newSongInputEl.value = '';
  if (stampHintEl) stampHintEl.hidden = true;
  syncRecordInputs();
  renderSongSuggestions();
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

// スタンプ（praise #145 / tempo #239）を付与／解除。報酬に影響しないので再計算は不要。
// 同じスタンプを再タップしたら解除（null）。保存してクラウドへ即送信。
function setSessionMark(kind, index, id) {
  const m = SESSION_MARKS[kind];
  const session = m && state.sessions[index];
  if (!session) return;
  const next = m.normalize(session[kind]) === id ? null : m.normalize(id);
  state.sessions = state.sessions.map((s, i) => (i === index ? { ...s, [kind]: next } : s));
  saveState(state);
  if (cloud) cloud.pushCloudDebounced(() => cloudFields(state));
  renderHistory();
}

// 連続日数の節目（このどれかに到達したら特別演出）。日常のお祝いと差をつける（#81）。
const STREAK_CELEBRATIONS = new Set([3, 7, 14, 30, 50, 100]);

// 記録演出の動画モジュール（./cat-video.js・#227）。記録ビューへ入ったとき idle で読み込み、
// 現スタイルのクリップを prefetch する。押されるまで＝記録が確定するまで不要なので動的 import（#284）。
// celebrateRecord は import 結果（or null）を待ってから再生判定するので、素早く記録しても取りこぼさない。
let catVideoPromise = null;
function primeCatVideo() {
  if (catVideoPromise) { catVideoPromise.then((m) => m?.prime(state.pet.catStyle)).catch(() => {}); return; }
  const load = () => import('./cat-video.js')
    .then((m) => { m.prime(state.pet.catStyle); return m; })
    .catch(() => null);   // オフライン等。読めなければ既存CSS演出のまま
  catVideoPromise = new Promise((resolve) => {
    const run = () => resolve(load());
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 200);
  });
}

// 記録直後の猫の演出を出し分ける。優先順位は 目標達成 > 節目 > 通常の確率。
// 目標にはじめて届いた記録は必ず動画、それ以外の通常記録だけ確率で動画を差し込む（節目は
// 既存の playCelebrate を温存）。動画が出せなければ既存のCSS演出にフォールバックする（#227）。
function celebrateRecord({ leveled, badgeCount, streakCurrent, streakAdvanced, goalReached }) {
  // 連続日数は「その値であるあいだ」ずっと真になる状態なので、`leveled` / `badgeCount` と同じく
  // **この記録で節目に到達したか**で見る。状態のまま見ると節目の日は全記録が節目扱いになり、
  // その日はクリップが一本も出なくなる（#305）。
  const milestone = leveled || badgeCount > 0 || (streakAdvanced && STREAK_CELEBRATIONS.has(streakCurrent));
  // catEl は fallback の中で取り直す。動画待ち（最大〜3秒）の間にクラウド onSnapshot →
  // renderHome() が挟まると #catStage は作り直され、先に掴んだノードは detach 済みになる。
  const fallback = () => {
    const catEl = document.querySelector('#catStage .cat');
    return milestone ? playCelebrate(catEl) : playHappy(catEl);
  };
  const level = affinityLevel(affinity(state)).level;
  const wantVideo = goalReached || (!milestone && Math.random() < recordClipChance(level));
  if (!wantVideo || !catVideoPromise) { fallback(); return; }
  catVideoPromise.then((m) => {
    if (!m) { fallback(); return; }
    return m.tryPlay(state.pet.catStyle).then((ok) => { if (!ok) fallback(); });
  }).catch(() => fallback());
}

// ポップアップ共通の単発表示。duration 後にフェードアウトし、transitionend で hidden に戻す。
// 素朴に once リスナーを張ると、連続表示（えさやり連打等）のときに前回のリスナーが残り、
// 表示アニメの transitionend で新しいポップアップを途中で hidden にしてしまう（#261 バグ修正）。
// 要素ごとに前回のタイマー・リスナーを張り替えて競合を断つ。onHidden は完全に消えた後に呼ぶ。
const popupCycles = new WeakMap();
function showPopup(popup, duration, onHidden) {
  const prev = popupCycles.get(popup);
  if (prev) {
    clearTimeout(prev.timer);
    popup.removeEventListener('transitionend', prev.onEnd);
  }
  popup.hidden = false;
  void popup.getBoundingClientRect();   // リフローを挟んでアニメーションを確実に再生
  popup.classList.add('coin-popup--show');
  const onEnd = () => {
    popup.removeEventListener('transitionend', onEnd);
    popup.hidden = true;
    onHidden?.();
  };
  const timer = setTimeout(() => {
    popup.classList.remove('coin-popup--show');
    popup.addEventListener('transitionend', onEnd);
  }, duration);
  popupCycles.set(popup, { timer, onEnd });
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
  showPopup(popup, 2000);
}

// えさやりのポップアップ（もぐもぐ＋なかよし上昇）
function showFeedPopup(food) {
  const popup = document.getElementById('feedPopup');
  if (!popup) return;
  setText('feedPopupIcon', food.icon);
  setText('feedPopupGain', `+${food.affinity}`);
  showPopup(popup, 1800);
}

// バッジ獲得ポップアップ（複数取得時は前のフェードアウト完了を待って順番に表示）
function showBadgePopup(badges) {
  const popup = document.getElementById('badgePopup');
  if (!popup || !badges.length) return;
  let i = 0;
  const showNext = () => {
    if (i >= badges.length) return;
    const b = badges[i++];
    document.getElementById('badgePopupIcon').textContent = b.icon;
    document.getElementById('badgePopupName').textContent = b.name;
    playSound('levelup', state);
    showPopup(popup, 2200, showNext);
  };
  showNext();
}

// きょうのおまけ（#148）：練習した日だけ低確率でもらえるプチ報酬のポップアップ
function showBonusPopup(amount) {
  const popup = document.getElementById('bonusPopup');
  if (!popup) return;
  setText('bonusPopupAmount', `+${amount}`);
  playSound('coin', state);
  showPopup(popup, 2200);
}

// お休み券で連続を守ったときのポップアップ
function showFreezePopup() {
  const popup = document.getElementById('freezePopup');
  if (!popup) return;
  playSound('coin', state);
  showPopup(popup, 2200);
}

// 変更後 sessions を全再計算して確定する共通経路（同日統合 #186・過去日挿入 #260）。
// applySession と違い報酬情報が返らないため、前後の diff から演出（コイン・レベル・バッジ）を出す。
function commitRecordedSessions(sessions, totalCount) {
  const prevCoins = state.pet.coins;
  const prevLevel = state.pet.level;
  const prevBadges = state.badges;
  const prevSessions = state.sessions;         // 目標到達判定は commitState（state 書換）より前に取る（#227）
  const prevStreak = state.streak.current;     // 連続日数の節目は「この記録で伸びたか」で見る（#305）
  const goal = currentGoal();
  const newState = recomputeState({ ...state, sessions }, spentTotal(state));
  const gainedBadges = newlyEarned(prevBadges, newState.badges);
  commitState(newState);
  cloud?.flushCloud();            // 記録確定はバッチ境界。debounce を待たず即送信（#146）
  track('practice_recorded', { totalCount }); // 回数のみ・曲名は送らない
  router.go('home');
  const leveled = newState.pet.level > prevLevel;
  const goalReached = crossedDailyGoal(prevSessions, newState.sessions, todayStr(), goal);
  celebrateRecord({
    leveled,
    badgeCount: gainedBadges.length,
    streakCurrent: newState.streak.current,
    streakAdvanced: newState.streak.current !== prevStreak,
    goalReached,
  });
  showCoinPopup({ coins: Math.max(0, newState.pet.coins - prevCoins), leveled, newLevel: newState.pet.level });
  playSound('record', state);
  if (leveled) playSound('levelup', state);
  if (gainedBadges.length) setTimeout(() => showBadgePopup(gainedBadges), 2200);
  resetRecordForm();
}

function submitRecord(event) {
  event.preventDefault();
  const today = todayStr();
  const date = formDate();   // 未来日は今日に丸め済み（#260）
  const { songs, totalCount } = recordMode === 'batch'
    ? collectSongs(readBatchRows())
    : stampsToSongs(stamps);

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
    // 当日の記録画面は「その日ぜんぶ」を表す（resetRecordForm で当日セッションから復元済み）。
    // よって追記ではなく置き換えて、当日中の押し増しが二重計上されないようにする（#186）。
    // 当日以外（日付欄を過去日に変えた場合）は従来どおり合算する。
    const isToday = date === today;
    const mergedSongs = combineSongs(isToday ? songs : [...existing.songs, ...songs]);
    const mergedCount = isToday ? totalCount : existing.totalCount + totalCount;
    const sessions = state.sessions.map((s, i) =>
      i === existingIndex ? { ...s, songs: mergedSongs, totalCount: mergedCount } : s);
    commitRecordedSessions(sessions, mergedCount);
    return;
  }

  // 過去日（最終練習日より前）の新規記録（#260）：applySession は「日付が時系列順で届く」
  // 前提の逐次更新なので、そのまま適用するとストリークが1に巻き戻り lastPracticeDate も
  // 過去日へ戻ってしまう。挿入して全再計算（日付昇順の再生）で整合させる。
  // きょうのおまけ（#148）は「その日の記録時の抽選」なので後追い入力では抽選しない。
  if (state.streak.lastPracticeDate && date < state.streak.lastPracticeDate) {
    commitRecordedSessions([{ date, songs, totalCount, bonusCoins: 0 }, ...state.sessions], totalCount);
    return;
  }

  const prevBadges = state.badges;
  const prevSessions = state.sessions;         // 目標到達判定は commitState より前に取る（#227）
  const prevStreak = state.streak.current;     // 連続日数の節目は「この記録で伸びたか」で見る（#305）
  const goal = currentGoal();
  // きょうのおまけ（#148）：その日の初回記録（同日既存なし）でのみ低確率で抽選
  const bonus = rollDailyBonus(Math.random());
  const { state: newState, rewards } = applySession(state, { date, songs, totalCount }, bonus);
  const gainedBadges = newlyEarned(prevBadges, newState.badges);
  commitState(newState);          // 保存 + ホーム再描画
  cloud?.flushCloud();            // 記録確定はバッチ境界。debounce を待たず即送信（#146）
  track('practice_recorded', { totalCount }); // 回数のみ・曲名は送らない
  router.go('home');              // ホームへ遷移
  // 節目（レベルアップ／新バッジ／連続日数の節目）は特別演出、通常はランダムなお祝い（#81）。
  // 今日の目標にはじめて届いた記録は動画演出を必ず（#227）。
  const goalReached = crossedDailyGoal(prevSessions, newState.sessions, todayStr(), goal);
  celebrateRecord({
    leveled: rewards.leveled,
    badgeCount: gainedBadges.length,
    streakCurrent: newState.streak.current,
    streakAdvanced: newState.streak.current !== prevStreak,
    goalReached,
  });
  showCoinPopup(rewards);         // 獲得コインのポップアップ
  // 効果音：記録完了 →（レベルアップ時のみ）レベルアップ音
  playSound('record', state);
  if (rewards.leveled) playSound('levelup', state);
  // コインポップアップの後に、おまけ→お休み券→新規バッジの順で表示
  let nextDelay = 2200;
  if (rewards.bonus > 0) { setTimeout(() => showBonusPopup(rewards.bonus), nextDelay); nextDelay += 2200; }
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
// 日付を変えたら、その日付が本来始まるべき内容へフォームを戻す（当日ぶんの持ち越し防止・#273）
recordDateEl?.addEventListener('change', onRecordDateChange);

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
  else if (btn.dataset.action === 'set-mark') setSessionMark(btn.dataset.mark, index, btn.dataset.id);
});

// ===== ショップの購入・装備操作 =====
document.getElementById('shopList')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.shop-btn[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  // buy=購入 / place=置物の配置トグル（#226） / toggle=装備トグル
  const next = action === 'buy' ? buyItem(state, id)
    : action === 'place' ? togglePlace(state, id)
    : toggleEquip(state, id);
  if (next === state) return;       // 変化なし（買えない等）
  if (action === 'buy') playSound('purchase', state);  // 購入音
  // first_outfit（#309）は inventory（購入）から判定するため、購入直後だけ再判定する
  // （device/place/equip は inventory を変えないので対象外）。次の記録まで待たせない。
  const prevBadges = state.badges;
  const withBadges = action === 'buy' ? { ...next, badges: checkBadges(next) } : next;
  const gainedBadges = action === 'buy' ? newlyEarned(prevBadges, withBadges.badges) : [];
  commitState(withBadges);          // 保存 + ホームの猫へ即反映
  renderShop();                     // ショップ表示を更新
  if (gainedBadges.length) setTimeout(() => showBadgePopup(gainedBadges), 300);
});

// ===== えさやり（#80・コインの使い道） =====
document.getElementById('feedList')?.addEventListener('click', (e) => {
  unlockAudio();
  const btn = e.target.closest('.shop-btn[data-action="feed"]');
  if (!btn) return;
  const id = btn.dataset.id;
  const next = feedCat(state, id);
  if (next === state) return;        // 買えない（コイン不足等）
  // affinity_max（#309）は pet.affinity から判定するため、えさやり直後に再判定する
  // （なかよしMAXの瞬間を次の記録まで待たせない）。
  const prevBadges = state.badges;
  const withBadges = { ...next, badges: checkBadges(next) };
  const gainedBadges = newlyEarned(prevBadges, withBadges.badges);
  commitState(withBadges);           // 保存 + ホーム再描画（なかよし反映）
  renderShop();                      // ショップのコイン・なかよし・ボタン更新
  playSound('record', state);        // もぐもぐ（やわらかいチャイム）
  showFeedPopup(foodById(id));
  if (gainedBadges.length) setTimeout(() => showBadgePopup(gainedBadges), 1800);
});

// ===== 猫とのインタラクション（#79） =====
// なでる/タップで反応（鳴く・喜ぶ・しっぽふり）。記録には影響しない安全な操作。
// たまに威嚇（hiss）したときは、喜び演出（ハート・しっぽふり）は出さない。
function petCat() {
  // きせかえ編集モード中はドラッグ優先（なで演出は出さない・#168）
  if (document.getElementById('catStage')?.classList.contains('cat-stage--editing')) return;
  unlockAudio();                                       // ユーザー操作で AudioContext を解錠
  const voice = rollCatVoice();                        // なで反応を抽選（音設定に依存しない）
  playCatVoice(state, voice);                          // 抽選結果の鳴き声を再生（OFF時は無音）
  const catEl = document.querySelector('#catStage .cat');
  if (voice === 'hiss') {                              // 威嚇は喜び演出なし・威嚇表情のみ（#187）
    playHiss(catEl);
    return;
  }
  // なかよしレベルが高いと、たまに「とくべつな えんしゅつ」が出る（#124 専用演出）
  if (Math.random() < bondCelebrateChance(affinityLevel(affinity(state)).level)) {
    playCelebrate(catEl);
  } else {
    playReaction(catEl);
  }
}
document.getElementById('catStage')?.addEventListener('click', petCat);

// ===== きせかえ：編集モードのトグル（#168） =====
// 「きせかえ」中はドラッグで衣装を動かせ、なでは無効。「できた！」で抜けて配置を保存。
// commitState はドロップごとに走るので、トグル解除時に追加保存は不要。
let dressupDisable = null;
// きせかえ編集は「きせかえ」を押したときだけ必要なので遅延読込（#284）。
async function toggleDressup() {
  const stage = document.getElementById('catStage');
  const btn = document.getElementById('dressupToggle');
  const picker = document.getElementById('stylePicker');
  const layerPanel = document.getElementById('layerPanel');
  if (!stage) return;
  if (!stage.classList.contains('cat-stage--editing')) {
    // 先にモジュールを読んでから編集モードに入る。cat-stage--editing が付いた時点で
    // ドラッグが必ず効く＝クラスが「編集モードが使える」合図になる（遅延読込の競合回避）。
    const { enableDressup } = await import('./dressup.js');
    if (stage.classList.contains('cat-stage--editing')) return;    // 読み込み待ちの間に連打された
    stage.classList.add('cat-stage--editing');
    dressupDisable = enableDressup(
      stage,
      () => state.pet.itemLayout ?? {},
      (layout) => commitState({ ...state, pet: { ...state.pet, itemLayout: layout } }),
    );
    if (btn) { btn.textContent = '✅ できた！'; btn.setAttribute('aria-pressed', 'true'); }
    if (picker) { renderStylePicker(); picker.hidden = false; }   // 猫スタイル選択（#66）
    if (layerPanel) { layerPanel.hidden = false; renderLayerPanel(); }   // まえ／うしろ（#270）
  } else {
    stage.classList.remove('cat-stage--editing');
    dressupDisable?.();
    dressupDisable = null;
    if (btn) { btn.textContent = '👗 きせかえ'; btn.setAttribute('aria-pressed', 'false'); }
    if (picker) picker.hidden = true;
    if (layerPanel) layerPanel.hidden = true;
  }
}
document.getElementById('dressupToggle')?.addEventListener('click', toggleDressup);

// ===== 猫スタイル切り替え（#66） =====
// きせかえ編集モード中だけ表示。サムネイルに本番 idle 画像をそのまま使うことで、
// 選択UIを開いた時点で各スタイルの画像が自動ロードされ、切替時のチラつきを防ぐ。
const STYLE_LABELS = { tora: 'ちゃとら', shiro: 'しろ', russianblue: 'ぐれー' };
function renderStylePicker() {
  const el = document.getElementById('stylePicker');
  if (!el) return;
  const current = normalizeStyle(state.pet.catStyle);
  el.innerHTML = CAT_STYLES.map((s) => `
    <button type="button" class="style-picker__btn" data-style="${s}" aria-pressed="${s === current}">
      <img src="${catImageSrc(s, 'low', 'idle')}" alt="" draggable="false">
      <span>${STYLE_LABELS[s]}</span>
    </button>`).join('');
}
document.getElementById('stylePicker')?.addEventListener('click', (e) => {
  const btnEl = e.target.closest('.style-picker__btn');
  if (!btnEl) return;
  const style = btnEl.dataset.style;
  if (style === normalizeStyle(state.pet.catStyle)) return;
  commitState({ ...state, pet: { ...state.pet, catStyle: style } });  // renderHome が猫を差し替え＆新スタイルを先読み
  renderStylePicker();                                                // 選択状態の更新
});

// ===== きせかえ：まえ／うしろパネル（#270） =====
// きせかえ編集モード中だけ表示。装着中＋配置中のアイテムを「まえ」「うしろ」の2段に並べ、
// チップをタップすると反対の段へ移動して猫の描画も即座に入れ替わる。
// ジェスチャ（ダブルタップ等）にしないのは、ドラッグ／ピンチと競合せず、
// 「うしろに送って見えなくなったアイテム」が一覧から必ず戻せるようにするため。
const LAYER_ROWS = [['front', 'まえ'], ['back', 'うしろ']];
const LAYER_LABEL = Object.fromEntries(LAYER_ROWS);

function renderLayerPanel() {
  const el = document.getElementById('layerPanel');
  if (!el || el.hidden) return;
  const layout = state.pet.itemLayout ?? {};
  // 未知IDは描画しない（allowlist・#312）。equippedItems/placedItems はクラウド doc 由来で
  // 任意文字列が入りうるが、猫の描画側（cat-image.js）は allowlist で弾いている。ここも揃える。
  const ids = [...(state.pet.equippedItems ?? []), ...(state.pet.placedItems ?? [])]
    .filter((id) => itemById(id) || isSceneItem(id));
  el.innerHTML = LAYER_ROWS.map(([layer, label]) => {
    const chips = ids.filter((id) => itemLayer(id, layout) === layer).map((id) => {
      const item = itemById(id);
      const to = LAYER_LABEL[layer === 'back' ? 'front' : 'back'];
      return `<button type="button" class="layer-panel__chip" data-item="${escapeHtml(id)}" data-layer="${layer}"
        aria-label="${escapeHtml(item?.name ?? id)} を ${to} に する">`+
        `<span aria-hidden="true">${escapeHtml(item?.icon ?? '❔')}</span><span>${escapeHtml(item?.name ?? id)}</span></button>`;
    }).join('');
    return `<div class="layer-panel__row"><span class="layer-panel__label">${label}</span>`+
      `${chips || '<span class="layer-panel__empty">なし</span>'}</div>`;
  }).join('');
}

document.getElementById('layerPanel')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.layer-panel__chip');
  if (!chip) return;
  const id = chip.dataset.item;
  const layer = chip.dataset.layer === 'back' ? 'front' : 'back';
  const layout = { ...(state.pet.itemLayout ?? {}) };
  layout[id] = { ...(layout[id] ?? {}), layer };     // 座標・スケールは保ったままレイヤーだけ差し替える
  commitState({ ...state, pet: { ...state.pet, itemLayout: layout } });   // renderHome がパネルも描き直す
  playSound('purchase', state);   // うしろへ送ると猫の陰に完全に隠れることがあるため、効いた合図を音でも返す
});

// ===== サウンドON/OFFトグル =====
document.getElementById('soundToggle')?.addEventListener('click', () => {
  unlockAudio();                    // ユーザー操作で AudioContext を解錠
  commitState(toggleSound(state));  // 設定を反転して保存（renderHome でボタン更新）
  if (isSoundOn(state)) playSound('coin', state);  // ONにした合図に短く鳴らす
});

// ===== がめんの あかるさ（テーマ・#151） =====
// テーマは端末ごとの好み（夜配慮）なのでクラウド同期する state ではなく localStorage に保存。
// 'auto' は属性を外して CSS の prefers-color-scheme に委ねる。head のインラインで先読み適用済み。
const THEME_KEY = 'pp-theme';
function applyTheme(choice) {
  const root = document.documentElement;
  if (choice === 'dark' || choice === 'light') root.dataset.theme = choice;
  else delete root.dataset.theme;
  document.querySelectorAll('#themeSwitch [data-theme-choice]').forEach((b) => {
    const on = b.dataset.themeChoice === choice;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
document.getElementById('themeSwitch')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-theme-choice]');
  if (!btn) return;
  try { localStorage.setItem(THEME_KEY, btn.dataset.themeChoice); } catch (_) {}
  applyTheme(btn.dataset.themeChoice);
});
try { applyTheme(localStorage.getItem(THEME_KEY) || 'auto'); } catch (_) { applyTheme('auto'); }

// ===== せってい：1日の目標回数（#238） =====
// 5〜20 に丸めて pet.dailyGoal に保存→クラウド即送信。ホームの進捗・記録画面のスタンプへ即反映。
// 報酬（コイン）には影響しない（達成ボーナス閾値は固定10）。
function setDailyGoal(value) {
  const goal = clampDailyGoal(value);
  if (goal === currentGoal() && state.pet.dailyGoal === goal) return;
  state.pet = { ...state.pet, dailyGoal: goal };
  saveState(state);
  if (cloud) cloud.pushCloudDebounced(() => cloudFields(state));
  const goalInput = document.getElementById('goalTargetInput');
  if (goalInput) goalInput.value = String(goal);   // クランプ結果を入力欄に反映
  renderHome();
  renderStampCard();                               // 記録画面が開いていればマス数も更新
}

document.getElementById('goalTargetInput')?.addEventListener('change', (e) => setDailyGoal(e.target.value));
document.getElementById('goalMinusBtn')?.addEventListener('click', () => setDailyGoal(currentGoal() - 1));
document.getElementById('goalPlusBtn')?.addEventListener('click', () => setDailyGoal(currentGoal() + 1));

// ===== せってい：データのバックアップ/復元（#140） =====
const settingsOverlayEl = document.getElementById('settingsOverlay');
const settingsGateEl = document.getElementById('settingsGate');
const settingsMenuEl = document.getElementById('settingsMenu');
const gateAnswerEl = document.getElementById('gateAnswer');
const gateErrorEl = document.getElementById('gateError');
const importFileEl = document.getElementById('importFile');
const importStatusEl = document.getElementById('importStatus');

// バックアップと親ゲートの出題は、設定オーバーレイを開くまで不要なので遅延読込（#284）。
// import() の解決はブラウザがキャッシュするので、2回目以降は待ちなしで返る。
let backupMod = null;
const loadBackup = async () => (backupMod ??= await import('./backup.js'));

// ゲートの正解（openSettings のたびに作り直す）。
let gateExpected = null;

async function openSettings() {
  const mod = await loadBackup().catch((err) => {   // 未キャッシュ＋回線断でだけ起きる
    console.warn('せっていを ひらけません（バックアップ機能の よみこみに しっぱい）', err);
    return null;
  });
  if (!mod) return;
  const p = mod.makeGateProblem();
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
    renderAccountList();                   // アカウント切替の現在値を反映（#182）
    const goalInput = document.getElementById('goalTargetInput');
    if (goalInput) goalInput.value = String(currentGoal());  // 目標回数の現在値を反映（#238）
    renderCloudSection();                  // クラウド保存先（がぞくコード）の現在値を反映（#233）
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

// 写真モード（#237）：飾った猫を1枚の画像にして共有／保存する。端末内完結・PII非送信。
// Web Share（ファイル対応）があれば共有シート、無ければダウンロードにフォールバック。
let photoBusy = false;
async function shareCatPhoto() {
  if (photoBusy) return;                       // 連打で多重生成しない
  const catEl = document.querySelector('#catStage .cat');
  if (!catEl) return;
  photoBusy = true;
  const btn = document.getElementById('photoBtn');
  btn?.setAttribute('disabled', '');
  try {
    const { renderCatCanvas, canvasToBlob } = await import('./cat-snapshot.js');
    const canvas = await renderCatCanvas(catEl, 600);
    const blob = await canvasToBlob(canvas, 'image/png');
    if (!blob) return;
    // ファイル名・タイトルに曲名・こども名は入れない（PII規約）。
    const file = new File([blob], 'pianopet.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'ピアノペット' });
        track('cat_photo_shared', {});         // 操作フラグのみ（画像・内容は送らない）
      } catch { /* ユーザーのキャンセルは無視（フォールバック保存はしない） */ }
      return;
    }
    // フォールバック：ダウンロード（Web Share 非対応環境）
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pianopet.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    track('cat_photo_saved', {});
  } catch (err) {
    console.warn('cat photo failed', err);
  } finally {
    btn?.removeAttribute('disabled');
    photoBusy = false;
  }
}

// 現行 state を JSON 化して a[download] でローカル保存（無害なので確認不要）。
async function downloadBackup() {
  // がぞくコード（#233）を同梱＝別端末で復元すると同じクラウド保存先に合流できる。
  const { exportState, backupFilename } = await loadBackup();
  const json = exportState(state, new Date(), getCloudDocId(getActiveAccountId()));
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
  const { RESTORE_BACKUP_KEY } = await loadBackup();
  try {
    const cur = localStorage.getItem(activeStorageKey());
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

// ===== クラウド保存先の推測不能化（がぞくコード・#233 段階1） =====
// 旧 doc ID は固定・推測可能だったため、ランダムな doc ID（がぞくコード）へ移す。
// 自動移行にすると端末ごとに別コードが生まれて家族の同期が割れるので、**親が明示操作**で行い、
// 他端末はコード入力（またはバックアップJSON取り込み）で同じ保存先に合流する。

const MIGRATE_BACKUP_KEY = 'piano-pet-backup-before-migrate';

function showCloudStatus(msg, isError) {
  const el = document.getElementById('cloudStatus');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.classList.toggle('settings-menu__note--error', !!isError);
}

// 親ゲート内のクラウド保存先セクションの表示を現在値に合わせる。
function renderCloudSection() {
  const code = getCloudDocId(getActiveAccountId());
  const notEl = document.getElementById('cloudNotMigrated');
  const yesEl = document.getElementById('cloudMigrated');
  if (notEl) notEl.hidden = !!code;
  if (yesEl) yesEl.hidden = !code;
  setText('cloudCodeValue', code ?? '—');
  const status = document.getElementById('cloudStatus');
  if (status) status.hidden = true;
}

// 移行：①ローカルへ退避 ②コード生成 ③新 doc へ現行データをコピー ④コード保存 ⑤リロード。
// 旧 doc の中身はこの時点では消さない（他端末がまだ旧 doc を見ている可能性があるため、
// 空にするのは全端末の合流後に親が明示操作で行う）。
async function migrateCloudDoc() {
  if (!cloud) { showCloudStatus('オフラインの ときは うつせません。', true); return; }
  const accountId = getActiveAccountId();
  if (getCloudDocId(accountId)) return;
  try {
    const cur = localStorage.getItem(activeStorageKey());
    if (cur) localStorage.setItem(MIGRATE_BACKUP_KEY, cur);   // 移行前の自動退避
  } catch { /* 退避失敗は致命的でないので無視 */ }

  const newId = generateCloudDocId();
  const ok = await cloud.pushCloudDoc(newId, cloudFields(state));   // 新 doc へコピー
  if (!ok) { showCloudStatus('うつせませんでした。つうしんを かくにんしてね。', true); return; }
  if (!setCloudDocId(accountId, newId)) { showCloudStatus('コードを ほぞんできませんでした。', true); return; }
  window.location.reload();   // cloud.js の購読 doc を貼り直す
}

// 他端末で発行されたコードに合流する。ローカルデータは消さず、次回同期で union マージされる。
function joinCloudDoc() {
  const input = document.getElementById('cloudCodeInput');
  const code = String(input?.value ?? '').trim();
  if (!isValidCloudDocId(code)) { showCloudStatus('コードの かたちが ちがうみたい。', true); return; }
  if (!setCloudDocId(getActiveAccountId(), code)) { showCloudStatus('コードを ほぞんできませんでした。', true); return; }
  window.location.reload();
}

// 旧（推測可能な）doc を空にする。全端末が合流済みであることが前提なので確認を挟む。
async function clearLegacyCloudDoc() {
  if (!cloud) { showCloudStatus('オフラインの ときは できません。', true); return; }
  const ok = window.confirm(
    'ふるい ばしょ（あてられる ID）の なかみを からに します。\n'
    + 'ほかの たんまつが まだ コードを いれていない ばあい、その たんまつは データを よみこめなく なります。\n'
    + 'すすめますか？',
  );
  if (!ok) return;
  const done = await cloud.pushCloudDoc(legacyCloudDocIdFor(getActiveAccountId()), {});
  showCloudStatus(done ? 'ふるい ばしょを からに しました。' : 'できませんでした。', !done);
}

// データ初期化（#183）：購入履歴・猫の状態・練習記録をすべて消して新品に戻す。
// applyImportedState と同じ安全手順（退避→購読解除→ローカル保存→クラウド反映→reload）で、
// 取り込み先が「新品の DEFAULTS」になるだけ。古いスナップショットの巻き戻しを断つ。
async function resetData() {
  if (!window.confirm('ねこの じょうたい・アイテム・れんしゅうきろくが ぜんぶ きえて、さいしょから になります。よろしいですか？')) return;
  const { RESTORE_BACKUP_KEY } = await loadBackup();
  try {
    const cur = localStorage.getItem(activeStorageKey());
    if (cur) localStorage.setItem(RESTORE_BACKUP_KEY, cur);   // 誤操作からの復旧用に退避
  } catch { /* 退避失敗は致命的でないので無視 */ }
  if (cloudUnsub) {
    try { cloudUnsub(); } catch { /* 解除失敗は無視 */ }
    cloudUnsub = null;
  }
  state = normalizeState({});            // 新品の DEFAULTS へ
  saveState(state);
  if (cloud) {
    try { await cloud.pushCloud(cloudFields(state)); } catch { /* push 失敗時もローカルは初期化済み */ }
  }
  window.location.reload();   // クリーンに再起動（状態変数の不整合・古い購読を一掃）
}

// 選択ファイルを読んで検証。OK なら確認のうえ復元、NG なら理由をひらがなで表示。
function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    const { parseBackup, importErrorMessage } = await loadBackup();
    const res = parseBackup(String(reader.result));
    if (!res.ok) {
      showImportStatus(importErrorMessage(res.reason), true);
      return;
    }
    if (!window.confirm('いまの データは きえて、ファイルの データに なります。よろしいですか？')) return;
    // バックアップに がぞくコード（#233）が入っていれば、同じクラウド保存先へ合流させる。
    if (res.cloudDocId) setCloudDocId(getActiveAccountId(), res.cloudDocId);
    applyImportedState(res.state);
  };
  reader.onerror = async () => showImportStatus((await loadBackup()).importErrorMessage('parse'), true);
  reader.readAsText(file);
}

// ===== せってい：アカウント切替（マルチアカウント・#182） =====
// 親ゲートの裏で、有効アカウント（娘／テスト用）を一覧表示し切り替える。切替は
// localStorage の有効アカウントを書き換えてからページをリロードし、storage の参照キーと
// cloud の購読 doc を新アカウントで貼り直す（import/reset と同じリロード方式）。
function renderAccountList() {
  const el = document.getElementById('accountList');
  if (!el) return;
  const activeId = getActiveAccountId();
  el.innerHTML = getAccounts().map((a) => {
    const isActive = a.id === activeId;
    const right = isActive
      ? '<span class="account-row__badge">いま これ ✓</span>'
      : `<button type="button" class="settings-btn settings-btn--ghost account-switch" data-account="${escapeHtml(a.id)}">きりかえる</button>`;
    return `<div class="account-row${isActive ? ' account-row--active' : ''}">
      <span class="account-row__name">${escapeHtml(a.name)}</span>
      ${right}
    </div>`;
  }).join('');
}

document.getElementById('accountList')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.account-switch');
  if (!btn) return;
  if (setActiveAccount(btn.dataset.account)) window.location.reload();
});

document.getElementById('settingsToggle')?.addEventListener('click', openSettings);
settingsOverlayEl?.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-settings"]')) closeSettings();
});

// ===== じぶんの アイコン（こどもアバター・#121） =====
const avatarOverlayEl = document.getElementById('avatarOverlay');
const childNameInputEl = document.getElementById('childNameInput');

// 選択グリッドを現在のアバターに合わせて描く。
function renderAvatarGrid() {
  const grid = document.getElementById('avatarGrid');
  if (!grid) return;
  const current = normalizeChildAvatar(state.pet.childAvatar);
  grid.innerHTML = CHILD_AVATARS.map((a) => `
    <button type="button" class="avatar-grid__btn" role="option" data-avatar="${a.id}" aria-selected="${a.id === current}" aria-pressed="${a.id === current}">${a.emoji}</button>`).join('');
}

function openAvatarPicker() {
  if (childNameInputEl) childNameInputEl.value = normalizeChildName(state.pet.childName);
  renderAvatarGrid();
  if (avatarOverlayEl) avatarOverlayEl.hidden = false;
}

// アバター/名前の変更を確定保存する。入力中の名前も一緒に正規化して載せるので、
// 名前だけ変えた場合も確実に永続化される。差分が無ければ保存しない。
function commitChildProfile(avatarId) {
  const childAvatar = normalizeChildAvatar(avatarId ?? state.pet.childAvatar);
  const childName = normalizeChildName(childNameInputEl?.value);
  if (childAvatar === state.pet.childAvatar && childName === state.pet.childName) return;
  commitState({ ...state, pet: { ...state.pet, childAvatar, childName } });  // renderHome→renderChildAvatar で両ヘッダ更新
}

function closeAvatarPicker() {
  commitChildProfile();
  if (avatarOverlayEl) avatarOverlayEl.hidden = true;
}

document.querySelector('.app')?.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="open-avatar"]')) openAvatarPicker();
});
avatarOverlayEl?.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-avatar"]')) closeAvatarPicker();
});
document.getElementById('avatarGrid')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.avatar-grid__btn');
  if (!btn) return;
  commitChildProfile(btn.dataset.avatar);   // アバター選択を即確定（名前も一緒に保存）
  renderAvatarGrid();                        // 選択状態の更新
});
// 名前は入力中もヘッダに即反映（state には触れず DOM だけ。確定は commitChildProfile）。
childNameInputEl?.addEventListener('input', () => {
  for (const el of document.querySelectorAll('.child-avatar__name')) {
    el.textContent = childNameInputEl.value;
  }
});
document.getElementById('gateSubmit')?.addEventListener('click', submitGate);
gateAnswerEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  submitGate();
});
document.getElementById('exportBtn')?.addEventListener('click', downloadBackup);
// クラウド保存先（がぞくコード・#233）
document.getElementById('cloudMigrateBtn')?.addEventListener('click', migrateCloudDoc);
document.getElementById('cloudJoinBtn')?.addEventListener('click', joinCloudDoc);
document.getElementById('cloudClearLegacyBtn')?.addEventListener('click', clearLegacyCloudDoc);
document.getElementById('cloudCopyBtn')?.addEventListener('click', async () => {
  const code = getCloudDocId(getActiveAccountId());
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showCloudStatus('コードを コピーしたよ！', false);
  } catch {
    showCloudStatus('コピーできませんでした。てで うつしてね。', true);
  }
});

document.getElementById('importBtn')?.addEventListener('click', () => importFileEl?.click());
document.getElementById('resetBtn')?.addEventListener('click', resetData);
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
  // ホームと同じ猫描画を流用（新規アセットなし）。案内中は通常表情を出す。
  const catEl = document.getElementById('onboardingCat');
  if (catEl) catEl.innerHTML = catMarkup({ mood: 'idle', name: state.pet.name, style: state.pet.catStyle });
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
// 初回の fetch → reconcile が完了したか（#313）。cloudSynced は import 成功で立つが、
// その後の fetchCloud（最大5秒）を待つ間に 'online' が発火すると、マージ前のローカル state で
// setDoc 全置換してしまう。この間の push は initialSyncDone で抑える。
let initialSyncDone = false;
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
  initialSyncDone = true;
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

// 復帰時の再同期（#242）。iOS PWA 等はサスペンド中 onSnapshot が届かないため、復帰直後の
// 古い in-memory state のまま操作すると、その古い pet が placedItems ごとクラウドを丸ごと
// 上書き（pushCloud=setDoc 置換）し、他端末で配置した置物が消える。復帰時に最新クラウドを
// fetch → 非破壊 union マージ（reconcileInitialCloud＝mergeCloudInitial 経路）で取り込み、
// 以後の push が最新の配置込みになるようにする。差分が無ければ getDoc 1 回で no-op。
async function resyncFromCloud() {
  if (!cloudSynced || !cloud) return;
  const cloudData = await cloud.fetchCloud();
  if (cloudData) reconcileInitialCloud(cloudData);
}

// オフライン起動後にネットワークが復帰したら同期を立ち上げ直す。
window.addEventListener('online', () => {
  if (!cloudSynced) { initCloudSync(); return; }
  // 初回 reconcile 前は送らない（マージ前のローカル state で全置換すると他端末の記録を消す・#313）。
  // 完了後は subscribe が最新を届けているので、復帰時に最新を一度送り直す。
  if (initialSyncDone) cloud?.pushCloud(cloudFields(state));
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
    resyncFromCloud();            // 復帰時に最新クラウドを取り込んでから操作を受ける（#242）
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
