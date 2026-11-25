import { createRouter, hashFromView, NAV_VIEWS } from './router.js';
import { escapeHtml } from './html.js';
import { loadState, saveState, cloudFields, mergeCloud, mergeCloudInitial, cloudDigest, normalizeState, normalizeLessonDates, activeStorageKey } from './storage.js';
import {
  getAccounts, getActiveAccountId, setActiveAccount,
  getCloudDocId, setCloudDocId, generateCloudDocId, isValidCloudDocId, legacyCloudDocIdFor,
} from './account.js';
import { todayStr, xpProgress, applySession, recomputeState, dailyProgress, crossedDailyGoal, mergeSameDaySessions, clampDailyGoal, rollDailyBonus, checkBadges, hasUncreditedLesson } from './game.js';
import { catMarkup, playHappy, playReaction, playCelebrate, playHiss, preloadTier, prefetchNextTier, tierFromBond, catImageSrc, CAT_STYLES, normalizeStyle, itemLayer } from './cat-image.js';
import { isValidSession, collectSongs, MAX_ROW_COUNT, songsToRows, stampsToSongs, songsToStamps, combineSongs, pastSongNames, songTotals, normalizePraise, normalizeTempo } from './record-form.js';
import { songColor, assignSongColors } from './song-color.js';
import { CHILD_AVATARS, normalizeChildAvatar, avatarEmoji, normalizeChildName } from './child-profile.js';
import {
  SHOP_ITEMS,
  SHOP_CATEGORIES,
  itemsInCategory,
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
import { isOnboarded } from './onboarding.js';

// エラー監視・利用計測（任意・キー未設定なら no-op）。早期に起動する。
initErrorMonitoring();
initAnalytics();

// 「きろく」ビュー専用モジュール（./history-view.js＝組み立て #382＋history.js を re-export）。ホーム表示には不要なので初回ロードから外す
// （#324・js-entry予算の残り確保）。「きろく」ビューへ入る／カレンダー操作／記録削除の入口でだけ待つ。
let historyMod = null;
const loadHistory = async () => (historyMod ??= await import('./history-view.js'));

// ===== 状態管理 =====
let state = loadState();

// 旧データに同日重複セッションがある場合は統合して再計算（統合そのものは recomputeState の入口）
if (mergeSameDaySessions(state.sessions) !== state.sessions) {
  state = recomputed({});
  saveState(state);
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

// いまの state に patch を重ねて全再計算したもの
function recomputed(patch) {
  return recomputeState({ ...state, ...patch }, spentTotal(state));
}

// 装備・配置していないアイテムの座標を itemLayout から除く（#168/#226 ゴーストデータ防止）。
// itemLayout は装着衣装と置物（#226）で共用するため、装備中 or 配置中のIDだけ残す。
function cleanItemLayout({ itemLayout, equippedItems, placedItems }) {
  const active = new Set([...equippedItems, ...placedItems]);
  return Object.fromEntries(Object.entries(itemLayout).filter(([id]) => active.has(id)));
}

// オフライン中の未送信変更の印＝立っている間の realtime は union（#358）
let offlineDirty = false;

// ===== 取り消しトースト（記録の削除・レッスン日・#398。購入は買う前の確認に替えた・#421） =====
// 1つだけ出す。次のトーストが出たら前のものは期限切れ扱い（onExpire を呼ぶ）にする。
const UNDO_MS = 5000;
let undoCycle = null;
function dismissUndoToast(expire = true) {
  const c = undoCycle;
  if (!c) return;
  undoCycle = null;
  clearTimeout(c.timer);
  const el = document.getElementById('undoToast');
  if (el) el.hidden = true;
  if (expire) c.onExpire?.();
}
function showUndoToast(message, label, onUndo, { onExpire } = {}) {
  dismissUndoToast(true);
  const el = document.getElementById('undoToast');
  if (!el) { onExpire?.(); return; }
  setText('undoToastMsg', message);
  setText('undoToastBtn', label);
  el.hidden = false;
  undoCycle = { onUndo, onExpire, timer: setTimeout(() => dismissUndoToast(true), UNDO_MS) };
}
document.getElementById('undoToastBtn')?.addEventListener('click', () => {
  const c = undoCycle;
  if (!c) return;
  undoCycle = null;
  clearTimeout(c.timer);
  document.getElementById('undoToast').hidden = true;
  c.onUndo();
});

// 記録の削除は取り消しの猶予（5秒）のあいだ確定しない（#398）。クラウド送信の待ち（2秒）より長いので、
// 先に確定すると墓標（deletedDates）が他端末へ届き、取り消しても union で消し直されるため。
// 期限切れ・別の保存（commitState）・アプリが裏へ回ったときに確定する。
let pendingDelete = null;
function withSessionDeleted(s, date) {
  const sessions = s.sessions.filter((x) => x.date !== date);
  const deletedDates = [...new Set([...s.deletedDates, date])];   // 墓標（#319）
  return recomputeState({ ...s, sessions, deletedDates }, spentTotal(s));
}
function applyPendingDelete() {
  if (pendingDelete) commitState(state);   // commitState が pendingDelete を重ねて確定する
}

// 取り込み前・印の間は送らない（#374・data-model.md）
const cloudPayload = () => (offlineDirty || overwriting ? null : cloudFields(state));
function queueCloudPush() {
  if (!cloud || !initialSyncDone) return;
  if (navigator.onLine === false) offlineDirty = true;
  if (!offlineDirty) cloud.pushCloudDebounced(cloudPayload);
}

// 取り消せる操作（レッスン日の解除）は、猶予が終わるまでクラウドへ送らない（#398）。先に届くと
// 取り消しても他端末の union（inventory・lessonRemoved）で買い直し／消し直しになる（削除の保留と同じ理由）。
function holdCloudPush() {
  if (!cloud || !initialSyncDone || offlineDirty) return;
  cloud.pushCloudDebounced(cloudPayload, UNDO_MS + 500);
}

// 端末への保存に失敗したままか（容量超過等）。次の保存が通れば追いつく
let unsaved = false;
function persist() {
  unsaved = !saveState(state);
  if (unsaved) showUndoToast('たんまつに ほぞんできなかったよ。あきを ふやしてね', 'わかった', () => {});
}

function commitState(newState) {
  // 取り消し待ちの削除（#398）があれば、この保存に重ねて確定する（別の操作で保存が走ったら猶予は終わり）
  const deleted = pendingDelete?.date;
  if (deleted) {
    pendingDelete = null;
    dismissUndoToast(false);
    newState = withSessionDeleted(newState, deleted);
  }
  // 別の保存が走ったら、出ている取り消し（レッスン日）は巻き戻すと他の変更まで消えるので閉じる
  if (undoCycle) dismissUndoToast(true);
  state = { ...newState, pet: { ...newState.pet, itemLayout: cleanItemLayout(newState.pet) } };
  persist();                        // ローカルキャッシュ（オフライン用）
  // 当日分を消したら下書きも消す。残すと次に記録画面を開いたとき消した回数が戻り、二重に記録される
  if (deleted === todayStr() && !unsaved) clearStampDraft();
  queueCloudPush();
  renderHome();
  if (deleted && router.current === 'history') renderHistory();   // 連続日数・カレンダーも消したあとの姿に
}

// ===== ホームの猫表示 =====
function moodForState(s) {
  const last = s.streak.lastPracticeDate;
  if (!last) return 'idle';
  const diffDays = Math.floor((Date.parse(todayStr()) - Date.parse(last)) / 86400000);
  return diffDays >= 2 ? 'sleep' : 'idle';
}

function renderHome() {
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
  renderStampHome();
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

// 親が設定した1日の目標回数（#238）
function currentGoal() {
  return clampDailyGoal(state.pet.dailyGoal);
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
  const lessonEl = document.getElementById('statLessonToday');   // レッスン日の表示（#393）
  if (lessonEl) lessonEl.hidden = !state.pet.lessonDates.includes(todayStr());
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
  setText('statFreezes', state.streak.freezes);
  setText('statAffinity', affinity(state));

  const pct = Math.round((xpInLevel / xpPerLevel) * 100);
  const fillEl = document.getElementById('statXpFill');
  if (fillEl) fillEl.style.width = `${pct}%`;
  const barEl = document.getElementById('statXpbar');
  if (barEl) barEl.setAttribute('aria-valuenow', String(pct));
}

// ===== 記録履歴画面 =====
// 表示中の月（練習カレンダー・#236）。初期値は今月。前月/翌月ボタンで移動する。
let calYear = null;
let calMonth = null;

function showThisMonth() {
  [calYear, calMonth] = todayStr().split('-').map(Number);
}
showThisMonth();

// 月間カレンダー（草式ヒートマップ・#236）。sessions 導出のみ・目標(#238)に濃淡が追従。
function renderCalendar() {
  const grid = document.getElementById('calGrid');
  if (!grid) return;
  setText('calTitle', historyMod.monthLabel(calYear, calMonth));
  const weeks = historyMod.monthGrid(calYear, calMonth, state.sessions, { today: todayStr(), goal: currentGoal(), lessonDates: state.pet.lessonDates });
  grid.innerHTML = historyMod.calendarCellsMarkup(weeks, calMonth);
}

async function moveCalendar(delta) {
  await loadHistory();
  const next = historyMod.shiftMonth(calYear, calMonth, delta);
  calYear = next.year;
  calMonth = next.month;
  renderCalendar();
}

const SONGS_SHOWN = 5;
let songsOpen = false;
function renderSongCollection() {
  const el = document.getElementById('songCollection');
  if (!el) return;
  const totals = songTotals(state.sessions);
  // 上位5曲だけ出す（#401）
  const rest = songsOpen ? 0 : Math.max(0, totals.length - SONGS_SHOWN);
  el.innerHTML = totals.length
    ? `<ul class="song-collection__list">${historyMod.songCollectionMarkup(totals.slice(0, totals.length - rest), buildSongColors())}</ul>`
      + (rest > 0 ? `<button type="button" class="settings-btn settings-btn--ghost settings-btn--block" data-action="more-songs">もっと みる（あと ${rest}きょく）</button>` : '')
    : '<p class="history-empty">まだ きょくが ないよ。</p>';
}

// 今週のふりかえりカード（#144）：今週の回数・きょく数・日数を集計して表示。
function renderReviewCard() {
  const sum = historyMod.weeklySummary(state.sessions, todayStr());
  setText('reviewCount', sum.count);
  setText('reviewSongs', sum.songCount);
  setText('reviewDays', sum.dayCount);
}

const HISTORY_PAGE = 14;
let historyShown = HISTORY_PAGE;

async function renderHistory() {
  await loadHistory();
  setText('historyStreakCurrent', state.streak.current);
  setText('historyStreakBest', state.streak.best);

  renderChildAvatar();
  renderReviewCard();
  renderCalendar();
  renderSongCollection();

  const chartEl = document.getElementById('weeklyChart');
  if (chartEl) {
    chartEl.innerHTML = historyMod.weeklyChartSvg(historyMod.weeklyChartModel(historyMod.weeklyTotals(state.sessions)));
  }

  const listEl = document.getElementById('historyList');
  if (listEl) {
    // 取り消し待ちの削除（#398）は一覧から除く
    const shown = state.sessions.filter((s) => s.date !== pendingDelete?.date)
      .sort((a, b) => b.date.localeCompare(a.date));
    const rest = shown.length - historyShown;
    listEl.innerHTML = shown.length
      ? shown.slice(0, historyShown).map(historyMod.historyCardMarkup).join('')
        + (rest > 0 ? `<button type="button" class="settings-btn settings-btn--ghost settings-btn--block" data-action="more-history">もっと みる（あと ${rest}けん）</button>` : '')
      : '<p class="history-empty">まだ きろくが ないよ。<br>れんしゅうを きろくしてね！</p>';
  }
}

// ===== ショップ画面 =====
// コイン不足は「あと ○ コイン」で次の目標として見せる（1かい＝1コイン・#360）
const shortBtn = (price) => `<button type="button" class="shop-btn shop-btn--locked" disabled>あと ${price - state.pet.coins} コイン</button>`;

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
      : shortBtn(item.price);
  } else if (active) {
    btn = `<button type="button" class="shop-btn shop-btn--unequip" data-action="${action}" data-id="${item.id}">${offLabel}</button>`;
  } else {
    btn = `<button type="button" class="shop-btn shop-btn--equip" data-action="${action}" data-id="${item.id}">${onLabel}</button>`;
  }

  const badge = active
    ? `<span class="shop-card__badge">${scene ? 'おうちに あるよ ✓' : 'みにつけてる ✓'}</span>`
    : '';   // ロック中はボタンが「なかよしLv○で あえる」と示すので、カード内では重ねて書かない（#399）
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
    : shortBtn(food.price);
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

// きせかえアイテムの絞り込み（#299）。リロードで「ぜんぶ」へ戻る（永続化しない）
let shopCategory = 'all';

function renderShop() {
  setText('shopCoins', state.pet.coins);
  setText('feedAffinity', affinity(state));
  setText('feedBondName', affinityLevel(affinity(state)).name);
  const feedEl = document.getElementById('feedList');
  if (feedEl) feedEl.innerHTML = FOODS.map(feedCardMarkup).join('');
  const rewardsEl = document.getElementById('bondRewards');
  if (rewardsEl) rewardsEl.innerHTML = affinityRewards(affinity(state)).map(bondRewardMarkup).join('');
  const listEl = document.getElementById('shopList');
  // 買える／買った品を先に、なかよしLv未到達のロック品は後ろへ（序盤はロックが大半で買える物が埋もれる・#399）
  const items = itemsInCategory(shopCategory);
  const open = (it) => isOwned(state, it.id) || isUnlocked(state, it.id);
  const sorted = [...items.filter(open), ...items.filter((it) => !open(it))];
  if (listEl) listEl.innerHTML = sorted.map(shopCardMarkup).join('');
  // ごはんも まだ持っていない品も1つも買えないときは、コインの増やし方を案内する（#399）
  const prices = [...FOODS.map((f) => f.price),
    ...SHOP_ITEMS.filter((it) => !isOwned(state, it.id) && isUnlocked(state, it.id)).map((it) => it.price)];
  const hintEl = document.getElementById('shopHint');
  if (hintEl) hintEl.hidden = state.pet.coins >= Math.min(...prices);
  const catsEl = document.getElementById('shopCats');
  if (catsEl) catsEl.innerHTML = SHOP_CATEGORIES.map(shopCategoryMarkup).join('');
}

function shopCategoryMarkup(c) {
  const on = c.id === shopCategory;
  return `<button type="button" class="shop-cat${on ? ' shop-cat--on' : ''}" data-cat="${c.id}" aria-pressed="${on}"><span aria-hidden="true">${c.icon}</span> ${c.name}</button>`;
}

// ===== バッジ画面 =====
function badgeCardMarkup(b) {
  return `<div class="badge-card${b.earned ? '' : ' badge-card--locked'}">
    <span class="badge-card__icon" aria-hidden="true">${b.earned ? b.icon : '🔒'}</span>
    <span class="badge-card__name">${b.name}</span>
    <span class="badge-card__desc">${b.desc}</span>
  </div>`;
}

function renderBadges() {
  setText('badgesCount', `${earnedCount(state)} / ${BADGES.length} こ ゲット！`);
  const grid = document.getElementById('badgeGrid');
  if (grid) grid.innerHTML = badgesWithStatus(state).map(badgeCardMarkup).join('');
}

// ===== ねこスタンプちょう（#409） =====
// 画面とロジックは使うときだけ読む（#284）
let stampMod = null;
const loadStamp = async () => (stampMod ??= await import('./stamp-view.js'));
const setStampBook = (stampBook) => commitState({ ...state, pet: { ...state.pet, stampBook } });

async function renderStampBook() {
  const el = document.getElementById('stampBook');
  const mod = await loadStamp().catch(() => null);
  if (!el) return;
  if (mod) el.innerHTML = mod.bookMarkup(state, todayStr());
  else el.textContent = 'よみこめませんでした。アプリを ひらきなおしてね';
}

function renderStampHome() {
  const link = document.getElementById('stampHomeLink');
  if (!link) return;
  if (!state.pet.stampBook.card) { link.hidden = true; return; }
  loadStamp().then((mod) => {
    const sum = mod.homeSummary(state, todayStr());
    link.hidden = !sum;
    if (!sum) return;
    link.textContent = sum.text;
    link.classList.toggle('stamp-home--ready', sum.ready);
  }).catch(() => {});
}

let stampPressing = false;
document.getElementById('stampBook')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.sb-press');
  if (!btn || stampPressing || !stampMod) return;
  stampPressing = true;
  const { date } = btn.dataset;
  try {
    setStampBook(stampMod.pressStamp(state.pet.stampBook, date));
    unlockAudio();
    setTimeout(() => playSound('peta', state), 160);   // 音の頭の0.25秒と合わせて着地（約0.41秒）に鳴らす
    await stampMod.animatePress(btn, stampMod.designForDate(date), date);
  } finally {
    stampPressing = false;   // 例外で押せないまま固まらないように
  }
  const st = stampMod.cardStatus(state, todayStr());
  await renderStampBook();
  if (st.full) {
    stampMod.celebrateGoal(st.card);
    playSound('fanfare', state);
  }
});
document.getElementById('stampHomeLink')?.addEventListener('click', () => router.go('stamp'));

let renderStampSettings = null;
async function showStampSettings() {
  const mod = await import('./stamp-settings.js').catch(() => null);
  if (!mod) return;
  renderStampSettings ??= mod.initStampSettings({ getState: () => state, today: todayStr, save: setStampBook });
  renderStampSettings();
}

// ===== ナビゲーション =====
const views = Array.from(document.querySelectorAll('.view'));
const navButtons = Array.from(document.querySelectorAll('.nav-btn'));

// なかよしMAX（affinity_max）の playCelebrate は、給餌時は #catStage が hidden で走らないため
// home へ遷移した瞬間まで持ち越す（#347）。毎回の給餌はショップ内のクリップで見せる（#294・features.md）。
let pendingFeedCelebrate = false;

function flushPendingFeedFx() {
  if (!pendingFeedCelebrate) return;
  pendingFeedCelebrate = false;
  playCelebrate(document.querySelector('#catStage .cat'));
}

function markNav(view) {
  for (const btn of navButtons) {
    const active = btn.dataset.nav === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  }
}

function render(view) {
  for (const el of views) {
    el.hidden = el.dataset.view !== view;
  }
  markNav(NAV_VIEWS.includes(view) ? view : 'home');   // record はナビに無いので、ナビ上は home を選択状態に保つ
  if (view === 'record') resetRecordForm();
  if (view === 'history') renderHistory();
  if (view === 'shop') renderShop();
  if (view === 'badges') renderBadges();
  if (view === 'stamp') renderStampBook();
  if (view === 'home') flushPendingFeedFx();
  window.scrollTo(0, 0);
}

const router = createRouter({
  onChange(view) {
    // 画面を移ったら削除の取り消し猶予は終わり（#398）。保留のまま記録画面を開くと、消した当日分が
    // フォームと下書きに復元され、送信でその日ごと消える・二重に記録される
    applyPendingDelete();
    // ホームを離れたら記録クリップを畳む（見えないまま保険タイマーまで待って、移った先にポップアップが出る・#400）
    if (view !== 'home') catVideoPromise?.then((m) => m?.stopClip(document.getElementById('catVideo'))).catch(() => {});
    render(view);
    if (view === 'record') primeCatVideo();   // 記録演出の動画モジュール＋クリップを先読み（#227・#284）
    if (view === 'shop') primeCatVideo('feed');   // えさやりクリップを先読み（#294）
    track('view_changed', { view });
    const target = hashFromView(view);
    if (window.location.hash !== target) {
      window.location.hash = target;
    }
  },
});

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.nav === 'history') {   // ナビから入り直したら直近へ（#360/#401）
      historyShown = HISTORY_PAGE;
      songsOpen = false;
    }
    router.go(btn.dataset.nav);
  });
});

document.getElementById('goRecordBtn')?.addEventListener('click', () => router.go('record'));
// 空状態の案内から各画面へ（ショップのコイン不足→記録・#399）
document.querySelector('.shop-hint__btn')?.addEventListener('click', () => router.go('record'));
document.getElementById('recordBackBtn')?.addEventListener('click', () => {
  if (editingDate != null) backToHistory();   // 「なおす」から来たら きろく の元の位置へ（#401）
  else router.go('home');
});
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
// 当日の記録があるなら復元元は記録（todayStamps）。下書きも残すと、その記録を別の日へ動かした・
// 他の端末で消したときに古い回数が戻り、二重に記録される（#428）。
function saveStampDraft() {
  if (editingDate != null) return;
  if (formDate() !== todayStr()) return;
  if (unsaved) return;   // 記録を端末に書けていない間は、確定前の下書きを残す（閉じると記録ごと失うため・#428）
  if (state.sessions.some((s) => s.date === todayStr())) { clearStampDraft(); return; }
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
  // いま どの曲に押しているかを大きく出す（前回の曲が選ばれたまま別の曲に押してしまう・#399）
  const songEl = document.getElementById('stampSong');
  if (songEl) {
    songEl.hidden = !selectedSong;
    songEl.textContent = selectedSong ? `🎵 いまは「${selectedSong}」` : '';
  }
  if (!songChipsEl) return;
  const colors = buildSongColors(chipNames);
  songChipsEl.innerHTML = chipNames
    .map((name) => {
      const selected = name === selectedSong;
      const c = colors.get(name) ?? songColor(name);
      // 選択中は曲の淡色＋濃い文字（白文字だと黄・緑系で読めない・#359）、未選択は色スウォッチで曲色を示す（#122）
      const style = selected
        ? `style="background:${c.tint};border-color:${c.fill};color:${c.ink};--song-fill:${c.fill}"`
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
function renderStampCard(fresh = false) {
  if (!stampCardEl) return;
  const goal = currentGoal();                 // 目標回数（#238・可変）に追従
  const colors = buildSongColors(chipNames);
  const filled = stamps.length;
  const cells = Math.max(goal, filled + 1);
  let html = '';
  for (let i = 0; i < cells; i += 1) {
    const isFilled = i < filled;
    const isGoal = i === goal - 1;
    // 押したマスは、その押下時に選ばれていた曲の色で塗る（曲ごとに色が変わる・#122）
    const style = isFilled ? ` style="${stampCellStyle(colors.get(stamps[i]) ?? songColor(stamps[i]))}"` : '';
    // 登場の演出は いま押したマスだけ（毎回作り直すので、全マスに付けるとカード全体が点滅する・#400）
    const isNew = fresh && i === filled - 1;
    html += `<span class="stamp-cell${isFilled ? ' is-filled' : ''}${isNew ? ' is-new' : ''}${isGoal ? ' is-goal' : ''}"${style} aria-hidden="true">${isFilled ? '🐾' : ''}</span>`;
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
    if (stampHintEl) {
      // 曲がまだ1つもないと「えらんでね」と言われても選べない（初回・#399）
      stampHintEl.textContent = chipNames.length ? 'きょくを えらんでね' : 'おうちの ひとと、うえの らんに きょくの なまえを いれてね';
      stampHintEl.hidden = false;
    }
    return;
  }
  const goal = currentGoal();
  const reachedGoal = stamps.length + 1 === goal;
  stamps.push(selectedSong);
  saveStampDraft();
  renderStampCard(true);
  // 押したマスのindexでドレミ…と音程が上がり、目標マスは高いドに解決する(#139・目標可変#238)
  playStamp(stamps.length - 1, state, goal);
  if (reachedGoal) {
    playSound('levelup', state);
    // 目標に届いたら送信ボタンを見える位置へ（押したあと下ナビの陰で、次に何を押すか分からない・#399）
    document.getElementById('recordSubmitBtn')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
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
      <input type="number" class="stepper__value batch-row__count" min="0" max="${MAX_ROW_COUNT}" inputmode="numeric" aria-label="かいすう" value="${count}">
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
    renderBatchRows(songsToRows(songs));
  } else {
    // まとめ → スタンプ：行を曲ごとに集約してスタンプ列へ展開
    stamps = songsToStamps(collectSongs(readBatchRows()).songs);
    saveStampDraft();
    if (stampHintEl) stampHintEl.hidden = true;
    syncRecordInputs();
  }
  recordMode = mode;
  applyRecordModeUI();
}

// モード表示（パネルの出し分け・タブの選択状態・エラー文言）を recordMode に同期。
function applyRecordModeUI() {
  const isBatch = recordMode === 'batch';
  if (stampModeEl) stampModeEl.hidden = isBatch;
  if (batchModeEl) batchModeEl.hidden = !isBatch;
  // [data-mode] に限定：同じ見た目の「がめんの あかるさ」ボタンの選択表示を消さない（#396）
  for (const btn of document.querySelectorAll('.record-mode__btn[data-mode]')) {
    const active = btn.dataset.mode === recordMode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));   // タブではなくトグル（矢印キー操作を約束しない・#397）
  }
  if (recordErrorEl) {
    recordErrorEl.textContent = isBatch ? '1かい いじょう にゅうりょくしてね' : '1かい いじょう おしてね';
  }
}

// 編集中の記録を**同一性（date）で**保持する。新規記録時は null（#314）。
// 記録は「同日1件」が不変条件（mergeSameDaySessions が保証）なので date が主キーになる。
// インデックスで持つと、編集フォームを開いたまま画面を離れて戻る間に mergeCloudInitial /
// recomputeState / 過去日 prepend で並びが変わり、別の日の記録を破壊する。
let editingDate = null;

// フォームが「その日ぜんぶ」を表している日付（当日ぶんを復元した日・#186）。それ以外の日付は足し算になる。
// 送信時の「今日」で判断すると、開いたまま日付をまたいだ送信で復元済みの回数まで足してしまう（#428）。
let restoredDate = null;

// 記録フォームの見出しとボタンを「新規」か「編集」かで切り替える
function setRecordMode(isEdit) {
  setText('recordTitle', isEdit ? 'きろくを なおす' : 'れんしゅうを きろく');
  setText('recordSubmitBtn', isEdit ? 'なおす' : 'きろくする');
  document.getElementById('recordBackBtn')?.setAttribute('aria-label', isEdit ? 'きろくにもどる' : 'ホームにもどる');
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
  renderBatchRows(songsToRows(stampsToSongs(stamps).songs));
}

// 記録済みの過去日を選んだら、既存の回数と「たしざん」になることを出す（二重記録の防止・#398）。
// 当日ぶんがフォームに復元されているときと、編集中（対象の記録そのもの）は出さない。
function updateRecordDateNote() {
  const el = document.getElementById('recordDateNote');
  if (!el) return;
  const date = formDate();
  const existing = editingDate == null && date !== restoredDate ? state.sessions.find((x) => x.date === date) : null;
  el.hidden = !existing;
  if (existing) el.textContent = `この ひは もう ${existing.totalCount}かい きろく してあるよ。いれた ぶんは たしざん されるよ。`;
}

// 日付を変えたら、その日付が本来始まるべき内容へフォームを戻す（→ features.md #273）。
// 今日=当日セッション/下書きから復元、今日以外=空。持ち越すと当日ぶんが二重計上される。
function onRecordDateChange() {
  const isToday = formDate() === todayStr();
  if (editingDate == null) restoredDate = isToday ? todayStr() : null;
  updateRecordDateNote();
  if (editingDate != null) return;   // 編集中は対象セッションの内容が正
  stamps = isToday ? todayStamps() : [];
  saveStampDraft();                   // 過去日は saveStampDraft 側のガードで no-op
  if (stampHintEl) stampHintEl.hidden = true;
  syncRecordInputs();
}

function resetRecordForm() {
  const noteEl = document.getElementById('recordDateNote');
  if (noteEl) noteEl.hidden = true;
  editingDate = null;
  setRecordMode(false);
  recordMode = 'stamp';
  if (recordDateEl) {
    recordDateEl.value = todayStr();
    recordDateEl.max = todayStr();   // 未来日はピッカーで選ばせない（時系列破壊防止・#260）
  }
  restoredDate = todayStr();
  stamps = todayStamps();
  saveStampDraft();
  if (newSongInputEl) newSongInputEl.value = '';
  if (stampHintEl) stampHintEl.hidden = true;
  syncRecordInputs();
  renderSongSuggestions();
  applyRecordModeUI();
  if (recordErrorEl) recordErrorEl.hidden = true;
}

// 「なおす」から きろく の元の位置へ戻る（#401）
let editReturnY = 0;
function backToHistory() {
  const y = editReturnY;
  router.go('history');
  renderHistory().then(() => window.scrollTo(0, y));
}

// 履歴から編集を開始：record 画面へ切り替えて（render() 内の resetRecordForm が新規の状態に戻す）から
// 対象の記録を流し込む。
function startEditSession(date) {
  const session = state.sessions.find((s) => s.date === date);
  if (!session) return;
  editReturnY = window.scrollY;
  router.go('record');
  editingDate = date;
  if (recordDateEl) recordDateEl.value = date;
  stamps = songsToStamps(session.songs);
  setRecordMode(true);
  syncRecordInputs();
  markNav('history');   // 編集中はナビも「きろく」を選択状態に（#401）
}

// 履歴から削除：確認のうえ該当セッションを除き、全再計算して保存
async function deleteSession(date) {
  await loadHistory();
  // 何が減るかも書く（全再計算でコイン・XP・れんぞくも戻る・#398）
  if (!window.confirm(`${historyMod.formatDateJa(date)} の きろくを けしますか？
コイン・レベル・れんぞく にちすうも その ぶん へります。`)) return;
  applyPendingDelete();            // 前の取り消し待ちは確定してから
  pendingDelete = { date };        // 確定は猶予のあと（墓標の扱いは withSessionDeleted の上のコメント）
  renderHistory();
  showUndoToast(`${historyMod.formatDateJa(date)} の きろくを けしたよ`, 'もとに もどす', () => {
    pendingDelete = null;
    renderHistory();
  }, { onExpire: applyPendingDelete });
}

// スタンプ（praise #145 / tempo #239）を付与／解除。報酬に影響しないので再計算は不要。
// 同じスタンプを再タップしたら解除（null）。保存してクラウドへ即送信。
function setSessionMark(kind, date, id) {
  const normalize = kind === 'tempo' ? normalizeTempo : normalizePraise;
  const sessions = state.sessions.map((s) => (s.date === date
    ? { ...s, [kind]: normalize(s[kind]) === id ? null : normalize(id) } : s));
  // スタンプで praise_all3 / tempo_all3 が成立しうる。購入・えさやりと同じくその場で
  // 再判定する（#320・設計判断は docs/features.md）。外す操作では剥がれない（checkBadges は state.badges 引継ぎ）。
  const prevBadges = state.badges;
  state = { ...state, sessions };
  state.badges = checkBadges(state);
  const gained = newlyEarned(prevBadges, state.badges);
  persist();
  queueCloudPush();
  renderHistory();
  if (gained.length) setTimeout(() => showBadgePopup(gained), 300);
}

// 連続日数の節目（このどれかに到達したら特別演出）。日常のお祝いと差をつける（#81）。
const STREAK_CELEBRATIONS = new Set([3, 7, 14, 30, 50, 100]);

// 記録・えさやり演出の動画モジュール（./cat-video.js・#227/#294）。記録ビューかショップへ入ったとき
// idle で読み込み、現スタイルのクリップを prefetch する。押されるまで＝記録が確定するまで不要なので動的 import（#284）。
// celebrateRecord は import 結果（or null）を待ってから再生判定するので、素早く記録しても取りこぼさない。
let catVideoPromise = null;
function primeCatVideo(kind = 'record') {
  const primeKind = (m) => (kind === 'feed' ? m.primeFeed : m.prime)(state.pet.catStyle);
  if (catVideoPromise) { catVideoPromise.then((m) => m && primeKind(m)).catch(() => {}); return; }
  const load = () => import('./cat-video.js')
    .then((m) => { primeKind(m); return m; })
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
  // 戻り値＝ポップアップを出してよい合図。動画のときは見終わるまで待つ（#400）
  if (!wantVideo || !catVideoPromise) { fallback(); return Promise.resolve(); }
  return new Promise((resolve) => {
    const noClip = () => { fallback(); resolve(); };
    catVideoPromise.then((m) => {
      if (!m) { noClip(); return; }
      return m.tryPlay(state.pet.catStyle, resolve).then((ok) => {
        if (!ok) noClip();
        else if (router.current !== 'home') m.stopClip(document.getElementById('catVideo'));   // 読み込みを待つ間にホームを離れた（#428）
      });
    }).catch(noClip);
  });
}

// ごほうびのポップアップを 2.2秒おきに順番に出す
function playRewardPopups(steps) {
  steps.filter(Boolean).forEach((show, i) => setTimeout(show, i * 2200));
}

// ポップアップ共通の単発表示。duration 後にフェードアウトし、transitionend で hidden に戻す。
// 素朴に once リスナーを張ると、連続表示（えさやり連打等）のときに前回のリスナーが残り、
// 表示アニメの transitionend で新しいポップアップを途中で hidden にしてしまう（#261 バグ修正）。
// 要素ごとに前回のタイマー・リスナーを張り替えて競合を断つ。onHidden は完全に消えた後に呼ぶ。
const popupCycles = new WeakMap();
// 別のポップアップが出るときは、残っている前のもの（購入時のバッジ等）を即座に畳む。
// 半透明で重なると両方とも読めない（#396）。畳んだものの onHidden（バッジ連鎖・えさやり後の
// バッジ告知）は捨てずに返し、新しく出したものが閉じたあとに回す。
// クリップ再生中のえさやりカードは動画ごと消えてしまうので畳まない。
function dismissOtherPopups(popup) {
  const carried = [];
  for (const other of document.querySelectorAll('.coin-popup.coin-popup--show')) {
    if (other === popup || other.classList.contains('coin-popup--clip')) continue;
    const c = popupCycles.get(other);
    if (c) {
      clearTimeout(c.timer);
      clearTimeout(c.fadeTimer);
      other.removeEventListener('transitionend', c.onEnd);
      popupCycles.delete(other);
      if (c.onHidden) carried.push(c.onHidden);
      carried.push(...c.deferred);
    }
    other.classList.remove('coin-popup--show');
    other.hidden = true;
  }
  return carried;
}
function showPopup(popup, duration, onHidden) {
  const carried = dismissOtherPopups(popup);
  const prev = popupCycles.get(popup);
  if (prev) {
    if (!prev.finished) carried.push(...prev.deferred);
    clearTimeout(prev.timer);
    clearTimeout(prev.fadeTimer);
    popup.removeEventListener('transitionend', prev.onEnd);
  }
  popup.hidden = false;
  void popup.getBoundingClientRect();   // リフローを挟んでアニメーションを確実に再生
  popup.classList.add('coin-popup--show');
  const cycle = { onHidden, deferred: carried, finished: false };
  const finish = () => {
    if (cycle.finished) return;
    cycle.finished = true;
    popup.removeEventListener('transitionend', cycle.onEnd);
    clearTimeout(cycle.fadeTimer);
    popup.hidden = true;
    onHidden?.();
    // onHidden が同じポップアップで続きを出した（バッジの連鎖）なら、回ってきた分はその後ろへ
    const next = popupCycles.get(popup);
    if (next && next !== cycle && !next.finished) next.deferred.push(...cycle.deferred);
    else cycle.deferred.forEach((f) => f());
  };
  cycle.onEnd = finish;
  const hide = () => {
    if (popupCycles.get(popup) !== cycle || cycle.hiding) return;   // 次の表示に張り替え済み／フェード中
    cycle.hiding = true;
    clearTimeout(cycle.timer);
    popup.classList.remove('coin-popup--show');
    popup.addEventListener('transitionend', cycle.onEnd);
    // prefers-reduced-motion（transition:none）だと opacity 遷移自体が起きず transitionend が
    // 永久に来ない。CSSの遷移時間（0.25s）に余裕を持たせた保険タイマーで確定させる
    // （放置すると showNext のバッジ連鎖が1件目で止まり、hidden も立たず role="status" の
    // 全画面オーバーレイがアクセシブルツリーに残り続ける）。400ms は cat-video.js の
    // 同種の保険タイマー（transition が効かない環境向け）と揃えた値。
    cycle.fadeTimer = setTimeout(finish, 400);
  };
  cycle.timer = setTimeout(hide, duration);
  popupCycles.set(popup, cycle);
  popup.onclick = hide;   // タップで次へ送る（#400）
  return hide;   // duration を待たずに閉じる（えさやりクリップの終了・スキップ・#294）
}

function showCoinPopup({ coins, leveled, newLevel, fixed = false }) {
  const popup = document.getElementById('coinPopup');
  if (!popup) return;
  // 回数が増えていない再記録・減らした記録では「+0 コイン ゲット！」と祝わない（#396）
  if (!fixed) playSound('coin', state);       // コイン獲得音（ポップアップ表示に同期）
  setText('coinPopupIcon', fixed ? '✏️' : '🪙');
  setText('coinPopupLabel', fixed ? 'きろくを なおしたよ' : 'コイン ゲット！');
  document.getElementById('coinPopupAmount').hidden = fixed;
  document.getElementById('coinPopupAmount').textContent = `+${coins}`;
  const levelUpEl = document.getElementById('coinPopupLevelUp');
  if (levelUpEl) {
    levelUpEl.hidden = !leveled;
    levelUpEl.textContent = leveled ? `レベル ${newLevel} に アップ！🎉` : '';
  }
  if (leveled) playSound('levelup', state);   // 表示と同時に鳴らす（動画のあとに出るので・#400）
  showPopup(popup, 2000);
}

// えさやりのポップアップ（なかよし上昇）。まず従来の静止カード（もぐもぐ）を出し、えさやり
// クリップ（#294）の再生が始まったらカードをクリップ表示に切り替えて、見終わる／タップまで出し続ける。
// クリップが出せなければ従来どおり 1800ms で閉じる。onHidden は閉じきった後に呼ぶ（連打で前回の
// サイクルが張り替えられると前回分は呼ばれないので、呼び出し側はキューを吐く冪等なものを渡す）。
function showFeedPopup(food, onHidden) {
  const popup = document.getElementById('feedPopup');
  const host = document.getElementById('feedClip');
  if (!popup) return;
  setText('feedPopupIcon', food.icon);
  setText('feedPopupGain', `+${food.affinity}`);
  popup.classList.remove('coin-popup--clip');
  let closed = false;
  showPopup(popup, 1800, () => { closed = true; onHidden?.(); });
  if (!host || !catVideoPromise) return;
  let hide = null;
  catVideoPromise
    .then((m) => m?.playFeedClip(host, state.pet.catStyle, food.id, () => hide?.()).then((ok) => {
      if (!ok) return;
      // モジュール読み込みが遅く、静止カードが閉じきってから再生が始まったら出さずに畳む
      // （開き直すと onHidden＝バッジ告知が2回走る）
      if (closed) { m.stopClip(host); return; }
      popup.classList.add('coin-popup--clip');
      hide = showPopup(popup, FEED_CLIP_MAX_MS, () => {
        popup.classList.remove('coin-popup--clip');
        onHidden?.();
      });
    }))
    .catch(() => {});
}
// クリップ（8秒）の ended／保険タイマーで閉じるので、これは両方が来なかったときの上限。
const FEED_CLIP_MAX_MS = 12000;

// バッジ獲得ポップアップ（前のフェードアウト完了を待って順番に表示）。表示中に次の獲得が来ても、
// 出ているものを置き換えず後ろに並べる（置き換えると読む前に消え、続きの連鎖も失われる・#428）。
const badgeQueue = [];
let badgeShowing = false;
function showBadgePopup(badges) {
  // 3つ以上は2つ目以降を1枚にまとめる（#400）
  if (badges.length > 2) {
    const rest = badges.slice(1);
    badges = [badges[0], { icon: rest.slice(0, 3).map((b) => b.icon).join(''), name: rest.map((b) => b.name).join('・') }];
  }
  badgeQueue.push(...badges);
  if (!badgeShowing) showNextBadge();
}
function showNextBadge() {
  const b = badgeQueue.shift();
  badgeShowing = !!b;
  if (!b) return;
  setText('badgePopupIcon', b.icon);
  setText('badgePopupName', b.name);
  playSound('levelup', state);
  showPopup(document.getElementById('badgePopup'), 2200, showNextBadge);
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

// 記録の確定：保存・送信 → ホームへ → お祝い → ごほうびのポップアップ。
// 全再計算で確定した記録（同日統合 #186・過去日挿入 #260 等）は報酬の内訳が無いので、コインは前後の差を出す。
// increased: その日の回数が増えた記録か（同じ内容の再送信・減らした修正は false・#396）
function finishRecord(newState, totalCount, {
  increased = true, coins = Math.max(0, newState.pet.coins - state.pet.coins), bonus = 0, frozeDays = 0,
} = {}) {
  const prev = state;   // 目標到達（#227）・連続の節目（#305）は commitState（state 書換）より前と比べる
  const goal = currentGoal();
  commitState(newState);
  cloud?.flushCloud();            // 記録確定はバッチ境界。debounce を待たず即送信（#146）
  track('practice_recorded', { totalCount }); // 回数のみ・曲名は送らない
  router.go('home');
  const gainedBadges = newlyEarned(prev.badges, newState.badges);
  const leveled = newState.pet.level > prev.pet.level;
  const goalReached = crossedDailyGoal(prev.sessions, newState.sessions, todayStr(), goal);
  const streakAdvanced = newState.streak.current !== prev.streak.current;
  // 何も増えていない（同じ内容の再送信・回数を減らした修正）ときは、お祝いの演出を出さない（#396）
  const ready = (increased || leveled || gainedBadges.length || goalReached || streakAdvanced)
    ? celebrateRecord({
      leveled,
      badgeCount: gainedBadges.length,
      streakCurrent: newState.streak.current,
      streakAdvanced,
      goalReached,
    })
    : Promise.resolve();
  playSound('record', state);   // 記録完了（レベルアップ音はコインのポップアップと一緒に鳴る）
  // コイン→おまけ→お休み券→バッジの順（#400）
  ready.then(() => playRewardPopups([
    () => showCoinPopup({ coins, leveled, newLevel: newState.pet.level, fixed: !increased && !leveled }),
    bonus > 0 && (() => showBonusPopup(bonus)),
    frozeDays > 0 && showFreezePopup,
    gainedBadges.length && (() => showBadgePopup(gainedBadges)),
  ]));
  resetRecordForm();
}

function submitRecord(event) {
  event.preventDefault();
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
  if (editingDate != null) {
    // 編集開始時の date で引き直す（並び替え・他端末の記録追加で index はズレる・#314）
    const idx = state.sessions.findIndex((s) => s.date === editingDate);
    if (idx < 0) {
      // ほかの端末で消された／統合された。無言で別の記録を壊さず案内を出す。
      if (recordErrorEl) {
        recordErrorEl.textContent = 'この きろくは ほかの ところで けされたみたい';
        recordErrorEl.hidden = false;
      }
      return;   // editingDate は残す（#401）
    }
    const sessions = state.sessions.map((s, i) =>
      i === idx ? { ...s, date, songs, totalCount } : s);
    // 日付を動かしたら元の日付は墓標へ（#358）
    const moved = date !== editingDate;
    const deletedDates = moved ? [...new Set([...state.deletedDates, editingDate])] : state.deletedDates;
    commitState(recomputed({ sessions, deletedDates }));
    resetRecordForm();
    // 日付を変えたら直した記録へ（#401）
    if (moved) {
      router.go('history');
      jumpToRecord(date);
    } else backToHistory();
    return;
  }

  // 同日に既存セッションがある場合は統合して全再計算（目標達成ボーナスの二重取りを防ぐ）
  const existing = state.sessions.find((s) => s.date === date);
  if (existing) {
    // 当日の記録画面は「その日ぜんぶ」を表す（resetRecordForm で当日セッションから復元済み）。
    // よって追記ではなく置き換えて、当日中の押し増しが二重計上されないようにする（#186）。
    // それ以外（日付欄を過去日に変えた場合）は合算する。
    const whole = date === restoredDate;
    const mergedSongs = combineSongs(whole ? songs : [...existing.songs, ...songs]);
    const mergedCount = whole ? totalCount : existing.totalCount + totalCount;
    const sessions = state.sessions.map((s) => (s === existing ? { ...s, songs: mergedSongs, totalCount: mergedCount } : s));
    finishRecord(recomputed({ sessions }), mergedCount, { increased: mergedCount > existing.totalCount });
    return;
  }

  // きょうのおまけ（#148）は「その日の記録時の抽選」なので、過去日の後追い入力では抽選しない。
  const last = state.streak.lastPracticeDate;
  const isPast = last && date < last;
  const bonus = isPast ? 0 : rollDailyBonus(Math.random());
  // applySession は「日付が時系列順で届く」前提の逐次更新なので、次の記録は挿入して全再計算で確定する。
  //   - 過去日（最終練習日より前・#260）：連続が1に巻き戻り lastPracticeDate も過去日へ戻ってしまう
  //   - 連続に未反映のレッスン日（#393）が間にある：先にレッスン日を練習日として挟む必要がある
  //   - 当日のレッスンだけが反映済み（date === last）：節目判定が再び立ち、おやすみけんが二重に付く
  if (isPast || date === last || hasUncreditedLesson(state, date)) {
    finishRecord(recomputed({ sessions: [{ date, songs, totalCount, bonusCoins: bonus }, ...state.sessions] }), totalCount);
    return;
  }

  const { state: newState, rewards } = applySession(state, { date, songs, totalCount }, bonus);
  finishRecord(newState, totalCount, rewards);
}

songChipsEl?.addEventListener('click', (e) => {
  const chip = e.target.closest('.song-chip');
  if (!chip) return;
  selectSong(chip.dataset.song);
});
document.getElementById('addSongBtn')?.addEventListener('click', addNewSong);
newSongInputEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;   // 変換確定の Enter では足さない（#428）
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
    const next = Math.min(MAX_ROW_COUNT, Math.max(0, (Number(countEl.value) || 0) + Number(stepBtn.dataset.step)));
    countEl.value = String(next);
    updateBatchTotal();
  }
});
batchRowsEl?.addEventListener('input', (e) => {
  if (e.target.matches('.batch-row__count') && Number(e.target.value) > MAX_ROW_COUNT) e.target.value = String(MAX_ROW_COUNT);
  updateBatchTotal();
});

// ===== 記録履歴の編集・削除 =====
document.getElementById('historyList')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  // 対象は date で引く（配列の位置は、別の保存や取り込みで並びが変わるとずれる・#314/#428）
  const date = btn.closest('.history-card')?.dataset.date;
  if (btn.dataset.action === 'edit-session') startEditSession(date);
  else if (btn.dataset.action === 'delete-session') deleteSession(date);
  else if (btn.dataset.action === 'set-mark') setSessionMark(btn.dataset.mark, date, btn.dataset.id);
  else if (btn.dataset.action === 'more-history') {
    const from = historyShown;
    historyShown += HISTORY_PAGE;
    // innerHTML の組み直しで body に落ちるフォーカスを、足した先頭の記録へ移す
    const list = e.currentTarget;
    renderHistory().then(() => list.children[from]?.querySelector('button')?.focus());
  }
});

// カレンダーの日からその日の記録カードへ（#401）
async function jumpToRecord(date) {
  const order = state.sessions.map((x) => x.date).sort().reverse();
  historyShown = Math.max(historyShown, order.indexOf(date) + 1);
  await renderHistory();
  const card = document.querySelector(`#historyList .history-card[data-date="${date}"]`);
  card?.scrollIntoView({ block: 'center' });
  // 「なおす」へ。取り消し待ちでカードが無ければ押した日へ
  (card?.querySelector('[data-action="edit-session"]') ?? document.querySelector(`#calGrid [data-date="${date}"]`))?.focus({ preventScroll: true });
}
document.getElementById('calGrid')?.addEventListener('click', (e) => {
  const cell = e.target.closest('.cal-cell[data-date]');
  if (cell) jumpToRecord(cell.dataset.date);
});
document.getElementById('songCollection')?.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="more-songs"]')) return;
  songsOpen = true;
  renderSongCollection();
  const list = e.currentTarget.querySelector('.song-collection__list');
  if (list) { list.tabIndex = -1; list.focus({ preventScroll: true }); }
});

// ===== ショップのカテゴリ絞り込み（#299） =====
document.getElementById('shopCats')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.shop-cat[data-cat]');
  if (!btn || btn.dataset.cat === shopCategory) return;
  shopCategory = btn.dataset.cat;
  renderShop();
  document.querySelector(`#shopCats .shop-cat[data-cat="${shopCategory}"]`)?.focus();   // 組み直しで落ちるフォーカスを戻す
});

// ===== ショップの購入・装備操作 =====
// 購入直後は同じ位置のボタンが「みにつける／おく」に替わるので、連打の2打目で着替え・配置まで
// 進まないよう、しばらく押せなくする（#396）
const BUY_GUARD_MS = 700;
// 「かう」は確認（#421）のあとに applyShopAction('buy') で買う。それ以外はすぐ反映
document.getElementById('shopList')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.shop-btn[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'buy') askBuy(btn.dataset.id);
  else applyShopAction(btn.dataset.action, btn.dataset.id);
});

function applyShopAction(action, id) {
  // buy=購入 / place=置物の配置トグル（#226） / toggle=装備トグル
  const next = action === 'buy' ? buyItem(state, id)
    : action === 'place' ? togglePlace(state, id)
    : toggleEquip(state, id);
  if (next === state) return;       // 変化なし（買えない等）
  if (action !== 'buy') {
    commitState(next);              // 保存 + ホームの猫へ即反映
    renderShop();
    return;
  }
  playSound('purchase', state);
  // first_outfit（#309）は inventory（購入）から判定するため、購入直後に再判定する（次の記録まで待たせない）
  const badges = checkBadges(next);
  const gainedBadges = newlyEarned(state.badges, badges);
  commitState({ ...next, badges });
  renderShop();
  const after = document.querySelector(`#shopList .shop-btn[data-id="${id}"]`);
  if (after) {
    after.disabled = true;
    setTimeout(() => { after.disabled = false; }, BUY_GUARD_MS);
  }
  if (gainedBadges.length) setTimeout(() => showBadgePopup(gainedBadges), 300);
}

// ===== かう の確認（#421）=====
// 買ったあとでは取り消しに気づかない（#398 の「やっぱり やめる」）ので、買う前に のこりコインを見せて決めさせる
const buyOverlayEl = document.getElementById('buyOverlay');
let buyPendingId = null;
async function askBuy(id) {
  const item = itemById(id);
  if (!item || !buyOverlayEl) return;
  buyPendingId = id;
  setText('buyTitle', `${item.name} を かう？`);
  setText('buyIcon', item.icon);
  setText('buyCoins', `🪙 ${state.pet.coins} → のこり ${state.pet.coins - item.price}`);
  const dlg = await loadDialog().catch(() => null);
  if (dlg) dlg.openDialog(buyOverlayEl, { onClose: closeBuy });
  else buyOverlayEl.hidden = false;
}
function closeBuy() {
  buyPendingId = null;
  if (dialogMod) dialogMod.closeDialog(buyOverlayEl);
  else buyOverlayEl.hidden = true;
}
buyOverlayEl?.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-buy"]')) closeBuy();
  else if (e.target.closest('#buyOkBtn') && buyPendingId) {
    const id = buyPendingId;
    closeBuy();
    applyShopAction('buy', id);
  }
});

// ===== えさやり（#80・コインの使い道） =====
let feedBadgeQueue = [];
function flushFeedBadges() {
  const badges = feedBadgeQueue;
  feedBadgeQueue = [];
  if (badges.length) showBadgePopup(badges);
}

document.getElementById('feedList')?.addEventListener('click', (e) => {
  unlockAudio();
  const btn = e.target.closest('.shop-btn[data-action="feed"]');
  if (!btn) return;
  const id = btn.dataset.id;
  const next = feedCat(state, id);
  if (next === state) return;        // 買えない（コイン不足等）
  // affinity_max（#309）は pet.affinity から判定するため、えさやり直後に再判定する
  // （なかよしMAXの瞬間を次の記録まで待たせない）。
  const badges = checkBadges(next);
  const gainedBadges = newlyEarned(state.badges, badges);
  commitState({ ...next, badges });  // 保存 + ホーム再描画（なかよし反映）
  renderShop();                      // ショップのコイン・なかよし・ボタン更新
  playSound('record', state);        // もぐもぐ（やわらかいチャイム）
  // バッジ告知はえさやりポップアップ（クリップ再生中はその終わり）を閉じきってから出す。連打で
  // 前回のポップアップが張り替えられても取りこぼさないよう、告知はキューに積んで最後に閉じた側が吐く。
  feedBadgeQueue.push(...gainedBadges);
  showFeedPopup(foodById(id), flushFeedBadges);
  // MAX到達（#309後追い）はホームへ戻った瞬間に playCelebrate（features.md 設計判断）。
  if (gainedBadges.some((b) => b.id === 'affinity_max')) pendingFeedCelebrate = true;
});
// クリップ表示中はポップアップのどこをタップしてもスキップ（クリップ本体のタップは cat-video.js 側で拾う）
document.getElementById('feedPopup')?.addEventListener('click', (e) => {
  const host = document.getElementById('feedClip');
  if (host && !host.contains(e.target)) catVideoPromise?.then((m) => m?.stopClip(host));
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
      () => state.pet.itemLayout,
      (layout) => commitState({ ...state, pet: { ...state.pet, itemLayout: layout } }),
    );
    if (btn) { btn.textContent = '✅ できた！'; btn.setAttribute('aria-pressed', 'true'); }
    if (picker) { renderStylePicker(); picker.hidden = false; }   // 猫スタイル選択（#66）
    if (layerPanel) { layerPanel.hidden = false; renderLayerPanel(); }   // まえ／うしろ（#270）
    stage.closest('.view-body')?.classList.add('is-dressup');   // 記録ボタンの固定を外す（#399）
  } else {
    stage.classList.remove('cat-stage--editing');
    dressupDisable?.();
    dressupDisable = null;
    if (btn) { btn.textContent = '👗 きせかえ'; btn.setAttribute('aria-pressed', 'false'); }
    if (picker) picker.hidden = true;
    if (layerPanel) layerPanel.hidden = true;
    stage.closest('.view-body')?.classList.remove('is-dressup');
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
  const layout = state.pet.itemLayout;
  // 未知IDは描画しない（allowlist・#312）。equippedItems/placedItems はクラウド doc 由来で
  // 任意文字列が入りうるが、猫の描画側（cat-image.js）は allowlist で弾いている。ここも揃える。
  const items = [...state.pet.equippedItems, ...state.pet.placedItems].map(itemById).filter(Boolean);
  // 何もつけていないと「まえ なし／うしろ なし」だけで何をすればいいか分からない（#399）
  if (!items.length) {
    el.innerHTML = '<p class="layer-panel__hint">まだ なにも つけていないよ。ショップで かってね</p>' +
      '<button type="button" class="layer-panel__shop" data-go="shop">🛍️ ショップへ</button>';
    return;
  }
  el.innerHTML = LAYER_ROWS.map(([layer, label]) => {
    const to = LAYER_LABEL[layer === 'back' ? 'front' : 'back'];
    const chips = items.filter((it) => itemLayer(it.id, layout) === layer).map((it) =>
      `<button type="button" class="layer-panel__chip" data-item="${it.id}" data-layer="${layer}" aria-label="${it.name} を ${to} に する">`
        + `<span aria-hidden="true">${it.icon}</span><span>${it.name}</span></button>`).join('');
    return `<div class="layer-panel__row"><span class="layer-panel__label">${label}</span>`+
      `${chips || '<span class="layer-panel__empty">なし</span>'}</div>`;
  }).join('') + '<p class="layer-panel__hint">タップすると まえ／うしろ が かわるよ</p>';
}

document.getElementById('layerPanel')?.addEventListener('click', (e) => {
  if (e.target.closest('[data-go="shop"]')) {
    toggleDressup();   // 編集モードを終えてから移る（残すと戻ったとき なでられない・#399）
    router.go('shop');
    return;
  }
  const chip = e.target.closest('.layer-panel__chip');
  if (!chip) return;
  const id = chip.dataset.item;
  const layer = chip.dataset.layer === 'back' ? 'front' : 'back';
  const layout = { ...state.pet.itemLayout };
  layout[id] = { ...layout[id], layer };     // 座標・スケールは保ったままレイヤーだけ差し替える
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
  const goalInput = document.getElementById('goalTargetInput');
  if (goalInput) goalInput.value = String(goal);   // 丸めた結果を入力欄に反映（目標が変わらないときも・#428）
  if (state.pet.dailyGoal === goal) return;
  state = { ...state, pet: { ...state.pet, dailyGoal: goal } };
  persist();
  queueCloudPush();
  renderHome();
  renderStampCard();                               // 記録画面が開いていればマス数も更新
}

document.getElementById('goalTargetInput')?.addEventListener('change', (e) => setDailyGoal(e.target.value));
document.getElementById('goalMinusBtn')?.addEventListener('click', () => setDailyGoal(currentGoal() - 1));
document.getElementById('goalPlusBtn')?.addEventListener('click', () => setDailyGoal(currentGoal() + 1));

// ===== せってい：ピアノのレッスンび（#393） =====
// pet.lessonDates を recomputeState で連続・コイン・XP に反映する（今日以前の登録日だけが対象）。
// 追加・解除どちらも全再計算なので、増減は常に sessions と登録日から導かれる。
// 解除した日は pet.lessonRemoved に残す（墓標）。初回マージの union で、もう1台に残った古い登録が
// 復活しないようにするため（sessions の deletedDates と同じ考え方・#319）。再登録すれば墓標は外す。
function setLessonDates(dates, { announce = false, onlyIfChanged = false } = {}) {
  const prevCoins = state.pet.coins;
  const lessonDates = normalizeLessonDates(dates);
  const lessonRemoved = normalizeLessonDates([...state.pet.lessonDates.filter((d) => !lessonDates.includes(d)),
    ...state.pet.lessonRemoved.filter((d) => !lessonDates.includes(d))]);
  const next = recomputed({ pet: { ...state.pet, lessonDates, lessonRemoved } });
  // 起動時の取りこみは、数値が動かなければ保存も送信もしない
  if (onlyIfChanged && next.pet.coins === state.pet.coins && next.pet.xp === state.pet.xp
      && next.streak.current === state.streak.current && next.streak.freezes === state.streak.freezes
      && next.streak.lastPracticeDate === state.streak.lastPracticeDate) return;
  commitState(next);
  const gained = next.pet.coins - prevCoins;
  if (announce && gained > 0) showCoinPopup({ coins: gained, leveled: false, newLevel: next.pet.level });
}

// 一覧の描画と入力の受け口は設定を開くまで不要なので遅延読込（lesson-settings.js・#284）
let renderLessonList = null;
async function showLessonSettings() {
  const mod = await import('./lesson-settings.js').catch(() => null);
  if (!mod) return;
  renderLessonList ??= mod.initLessonSettings({
    getDates: () => state.pet.lessonDates,
    setDates: setLessonDates,
    today: todayStr,
    // スクロール中の誤タップで連続日数が切れないよう、解除は取り消せる（#398）
    onRemoved: (d) => {
      holdCloudPush();
      showUndoToast(`${d.slice(5).replace('-', '/')} の レッスンびを とりけしたよ`, 'もとに もどす', () => {
        setLessonDates([...state.pet.lessonDates, d]);
        renderLessonList?.();
      });
    },
  });
  renderLessonList(true);   // 開くたびに畳む
}

// 「きょう」になったレッスン日が未反映なら取りこむ。旧版の端末が落とした分（最終練習日以前のレッスン日）も
// 拾えるよう、登録日があれば毎回再計算する。
function creditDueLessons() {
  if (state.pet.lessonDates.length) setLessonDates(state.pet.lessonDates, { announce: true, onlyIfChanged: true });
}
setTimeout(creditDueLessons, 0);   // 起動時（モジュール評価の完了後に実行）

// 開いたまま日付をまたいで戻ってきたら、昨日のままの表示（きょうの もくひょう・レッスンび等）を
// 描き直す（#428）。記録画面に書きかけがあるときは、その日付の記録として出せるよう触らない。
// レッスン日の取りこみは保存・送信を伴うので、クラウドを取り込んだあと（resyncAndSettle）に回す。先に送ると、
// 休んでいた間の古い state で他の端末の記録・購入を消す（#242）。
let shownDay = todayStr();
let lessonsDue = false;
function refreshOnNewDay() {
  if (shownDay === todayStr()) return;
  shownDay = todayStr();
  lessonsDue = true;
  showThisMonth();
  renderHome();
  if (router.current !== 'record' || !hasUnsentInput()) render(router.current);
}

function hasUnsentInput() {
  if (editingDate != null || recordMode === 'batch') return true;
  // 復元した日なら保存済みの内容、それ以外（過去日）は空のカードから始まっている
  const saved = formDate() === restoredDate ? state.sessions.find((s) => s.date === restoredDate) : null;
  return JSON.stringify(stamps) !== JSON.stringify(songsToStamps(combineSongs(saved?.songs)));
}

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
// モーダル共通の操作（#397）も開くときまで要らないので遅延読込。閉じる側は開いた後なので読込済み。
let dialogMod = null;
const loadDialog = async () => (dialogMod ??= await import('./dialog.js'));

// ゲートの正解（openSettings のたびに作り直す）。
let gateExpected = null;

async function openSettings() {
  // アカウント切替・読み込み・初期化は reload を伴い、pagehide で別アカウントの保存先へ確定してしまう（#398）
  applyPendingDelete();
  const mod = await loadBackup().catch((err) => {   // 未キャッシュ＋回線断でだけ起きる
    console.warn('せっていを ひらけません（バックアップ機能の よみこみに しっぱい）', err);
    return null;
  });
  if (!mod) return;
  const dlg = await loadDialog().catch(() => null);
  showLessonSettings();
  showStampSettings();
  const p = mod.makeGateProblem();
  gateExpected = p.answer;
  setText('gateA', p.a);
  setText('gateB', p.b);
  if (gateAnswerEl) gateAnswerEl.value = '';
  if (gateErrorEl) gateErrorEl.hidden = true;
  if (importStatusEl) importStatusEl.hidden = true;
  if (settingsGateEl) settingsGateEl.hidden = false;   // 毎回ゲートから
  if (settingsMenuEl) settingsMenuEl.hidden = true;
  if (!settingsOverlayEl) return;
  if (dlg) dlg.openDialog(settingsOverlayEl, { onClose: closeSettings, initial: gateAnswerEl });
  else { settingsOverlayEl.hidden = false; gateAnswerEl?.focus(); }
}

function closeSettings() {
  if (!settingsOverlayEl) return;
  if (dialogMod) dialogMod.closeDialog(settingsOverlayEl);
  else settingsOverlayEl.hidden = true;
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
    renderRestorePrev();                   // 読み込み・初期化の前へ戻す（#398）
    if (settingsMenuEl) dialogMod?.focusIn(settingsMenuEl);   // ゲートが消えてフォーカスが body に落ちないように（#397）
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
    const blob = await canvasToBlob(canvas);
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
    downloadBlob(blob, 'pianopet.png');
    track('cat_photo_saved', {});
  } catch (err) {
    console.warn('cat photo failed', err);
  } finally {
    btn?.removeAttribute('disabled');
    photoBusy = false;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// 現行 state を JSON 化して a[download] でローカル保存（無害なので確認不要）。
async function downloadBackup() {
  // がぞくコード（#233）を同梱＝別端末で復元すると同じクラウド保存先に合流できる。
  const { exportState, backupFilename } = await loadBackup();
  const json = exportState(state, new Date(), getCloudDocId(getActiveAccountId()));
  downloadBlob(new Blob([json], { type: 'application/json' }), backupFilename());
  showImportStatus('ファイルを ほぞんしたよ！', false);
}

let overwriting = false;   // 上書き中は、届いたクラウドの内容も保留中の送信も無視する（#378）
// 不通の回線では setDoc が解決しないので10秒で見切る。時間内に送れたら true（#381 #384・data-model.md）
const withinLimit = (push) => Promise.race([
  push.then((ok) => ok === true, () => false),
  new Promise((r) => setTimeout(() => r(false), 10000)),
]);
const UNSENT_KEY = 'piano-pet:overwrite-unsent';

// 上書きの push。届かなかったら印を残し、次の起動で親に伝える（#384）
async function pushForOverwrite(docId = null) {
  const data = cloudFields(state);
  const ok = cloud && navigator.onLine !== false
    && await withinLimit(docId ? cloud.pushCloudDoc(docId, data) : cloud.pushCloud(data));
  if (!ok) try { localStorage.setItem(UNSENT_KEY, '1'); } catch { /* 無視 */ }
}

function stopCloudForOverwrite() {
  overwriting = true;
  clearTimeout(retryTimer);
  if (cloudUnsub) {
    try { cloudUnsub(); } catch { /* 解除失敗は無視 */ }
    cloudUnsub = null;
  }
}

// 読み込み・初期化の直前のデータを退避し、「ひとつ まえの データに もどす」で戻せるようにする（#398）
async function stashBeforeOverwrite() {
  return (await loadBackup()).stashBeforeOverwrite(localStorage, activeStorageKey(), stashOwner());
}
const stashOwner = () => ({ account: getActiveAccountId(), doc: getCloudDocId(getActiveAccountId()) ?? null });
const readStashedState = () => backupMod?.readStash(localStorage, stashOwner()) ?? null;
function renderRestorePrev() {
  const btn = document.getElementById('restorePrevBtn');
  if (btn) btn.hidden = !readStashedState();
}
async function restorePrevData() {
  const prev = readStashedState();
  if (!prev) return;
  const when = prev.at ? new Date(prev.at) : null;
  const label = when ? `${when.getMonth() + 1}がつ${when.getDate()}にち ${when.getHours()}:${String(when.getMinutes()).padStart(2, '0')} の` : 'まえの';
  if (!window.confirm(`${label} じょうたいに もどします（データを よみこむ・けす まえ）。そのあとに つけた きろくは きえます。いまの データと いれかわるので、もういちど おすと もどせます。よろしいですか？`)) return;
  applyImportedState(prev.state);   // いまの データは退避されるので、もう一度押せば行き来できる
}

// 取り込み確定：①直前データを退避 ②ローカル保存 ③クラウド購読を解除
// ④クラウドへ反映完了を待つ ⑤リロード。古いスナップショットの巻き戻しを断つ（#140 設計レビュー C/D）。
// ②が書けなければ何も変えずにやめる（クラウドだけ置き換わって端末が元のままになるのを防ぐ・#428）。
// code＝がぞくコード同梱の復元先（DATA_DOC は切替前の doc に固定のため・#358）。
async function applyImportedState(imported, code = null) {
  const revertStash = await stashBeforeOverwrite();   // 誤読込からの復旧用。退避の素性を元の保存先で残すため、コードの切替より前に（#398）
  if (!saveState(imported)) {
    revertStash();
    showImportStatus('たんまつの あきが たりなくて ほぞんできませんでした。', true);
    return;
  }
  stopCloudForOverwrite();
  state = imported;
  const docId = code && setCloudDocId(getActiveAccountId(), code) ? code : null;
  clearStampDraft();   // 前のデータの書きかけを、入れ替えたデータの記録にしない（#428）
  await pushForOverwrite(docId);
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
  const ok = await withinLimit(cloud.pushCloudDoc(newId, cloudFields(state)));   // 新 doc へコピー
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
  const done = await withinLimit(cloud.pushCloudDoc(legacyCloudDocIdFor(getActiveAccountId()), {}));
  showCloudStatus(done ? 'ふるい ばしょを からに しました。' : 'できなかった かもしれません。つうしんを かくにんしてね。', !done);
}

// データ初期化（#183）：購入履歴・猫の状態・練習記録をすべて消して新品に戻す。
function resetData() {
  if (!window.confirm('ねこの じょうたい・アイテム・れんしゅうきろくが ぜんぶ きえて、さいしょから になります。よろしいですか？')) return;
  applyImportedState(normalizeState({}));
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
    applyImportedState(res.state, res.cloudDocId);
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
    <button type="button" class="avatar-grid__btn" role="option" data-avatar="${a.id}" aria-label="${a.label}" aria-selected="${a.id === current}" aria-pressed="${a.id === current}">${a.emoji}</button>`).join('');
}

async function openAvatarPicker() {
  const dlg = await loadDialog().catch(() => null);
  if (childNameInputEl) childNameInputEl.value = normalizeChildName(state.pet.childName);
  renderAvatarGrid();
  if (!avatarOverlayEl) return;
  if (dlg) dlg.openDialog(avatarOverlayEl, { onClose: closeAvatarPicker });
  else avatarOverlayEl.hidden = false;
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
  if (!avatarOverlayEl) return;
  if (dialogMod) dialogMod.closeDialog(avatarOverlayEl);
  else avatarOverlayEl.hidden = true;
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
document.getElementById('restorePrevBtn')?.addEventListener('click', restorePrevData);
importFileEl?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) handleImportFile(file);
  e.target.value = '';   // 同じファイルを連続選択しても change が発火するように
});

window.addEventListener('hashchange', () => router.syncFromHash(window.location.hash));

// 初期表示
renderHome();
router.syncFromHash(window.location.hash);

// 前回の初期化・復元がクラウドへ届かなかったら一度だけ伝える（#384）
try {
  if (localStorage.getItem(UNSENT_KEY)) {
    localStorage.removeItem(UNSENT_KEY);
    loadBackup().then((m) => window.alert(m.OVERWRITE_UNSENT_MESSAGE)).catch(() => {});
  }
} catch { /* 無視 */ }

// 初回起動なら使い方の案内を出す（renderHome 後に重ねる）。画面は未表示のときだけ読む（#365）
if (!isOnboarded()) {
  import('./onboarding-ui.js')
    .then((m) => m.showOnboarding(catMarkup({ mood: 'idle', name: state.pet.name, style: state.pet.catStyle })))
    .catch(() => {});   // 読めなくても本体は動く（次の起動で出る）
}

// ===== クラウド同期（Firestore） =====
// ローカルで即描画したあと、クラウドと突き合わせる。SDK は CDN 読み込みなので
// 動的 import で取り込み、失敗（オフライン等）してもローカル動作を妨げない。

// 表示中の画面を今の state で描き直す（記録画面は入力中の内容を持つので触らない）
function refreshView() {
  if (router.current === 'history') renderHistory();
  else if (router.current === 'shop') renderShop();
  else if (router.current === 'badges') renderBadges();
  else if (router.current === 'stamp' && !stampPressing) renderStampBook();
}

// 取り込んだ state に差し替えて、ホームと表示中の画面を描き直す
function adoptState(next) {
  state = next;
  persist();                   // ローカルキャッシュも最新に
  renderHome();
  refreshView();
}

// クラウドのデータを現在の state に取り込んで再描画する。
// 自分の書き込みのエコーなど「実質変化なし」のときは再描画をスキップする。
function applyRemoteState(cloudData) {
  if (offlineDirty) {
    reconcileInitialCloud(cloudData);
    if (navigator.onLine !== false) offlineDirty = false;
    return;
  }
  const merged = mergeCloud(state, cloudData);
  if (cloudDigest(merged) === cloudDigest(state)) return;
  adoptState(merged);
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
  if (overwriting) return;
  if (cloudData) {
    reconcileInitialCloud(cloudData);       // 初回はローカル優先マージ（起動直後の記録を消さない）
  } else if (cloudData === null && hasLocalData(state)) {
    cloud.pushCloud(cloudFields(state));    // 初回移行（doc が無いときだけ）。ack は待たない（#374）
  } else if (cloudData === undefined) {
    offlineDirty = true;                    // 取れなかった：最初のスナップショットを union で取り込む（#362）
    scheduleRetry();
  }
  initialSyncDone = true;
  cloudUnsub = cloud.subscribeCloud(applyRemoteState);   // 以降は他端末の変更をリアルタイム反映（ハンドルは復元時の解除用に保持）
}

// 初回 fetchCloud の取り込み（#142）。realtime onSnapshot の cloud-wins（applyRemoteState）と違い、
// 起動直後（idle 同期完了前）にローカルで記録した内容を cloud で上書きしないよう、
// mergeCloudInitial でフィールドごとにローカル優先マージし、sessions から全導出値を再計算する。
function reconcileInitialCloud(cloudData) {
  if (overwriting) return;
  const merged = mergeCloudInitial(state, cloudData);
  const reconciled = recomputeState(merged, spentTotal(merged));
  const reconciledCloud = cloudDigest(reconciled);

  if (reconciledCloud !== cloudDigest(state)) adoptState(reconciled);
  // ローカルだけが持っていた記録（起動直後に記録した分など）でクラウドが古ければ確定保存する。
  if (reconciledCloud !== cloudDigest(normalizeState(cloudData))) {
    cloud?.pushCloud(cloudFields(state));
  }
}

// 復帰時の再同期（#242）。iOS PWA 等はサスペンド中 onSnapshot が届かないため、復帰直後の
// 古い in-memory state のまま操作すると、その古い pet が placedItems ごとクラウドを丸ごと
// 上書き（pushCloud=setDoc 置換）し、他端末で配置した置物が消える。復帰時に最新クラウドを
// fetch → 非破壊 union マージ（reconcileInitialCloud＝mergeCloudInitial 経路）で取り込み、
// 以後の push が最新の配置込みになるようにする。差分が無ければ getDoc 1 回で no-op。
async function resyncFromCloud() {
  if (!cloudSynced || !cloud) return false;
  const cloudData = await cloud.fetchCloud();
  if (overwriting) return false;
  if (cloudData) reconcileInitialCloud(cloudData);
  else if (cloudData === null && hasLocalData(state)) cloud.pushCloud(cloudFields(state));
  return cloudData !== undefined;
}

// 印を下ろす条件は data-model.md #358
const resyncAndSettle = () => resyncFromCloud()
  .then((ok) => {
    const offline = navigator.onLine === false;
    if (ok && !offline) offlineDirty = false;
    // 取り込めたか、いま保存しても送信されない（未接続・初回同期前）ときだけ。取れなければ次の再同期で
    if (!lessonsDue || overwriting || !(ok || offline || !initialSyncDone)) return;
    lessonsDue = false;
    creditDueLessons();
    refreshView();
  });
let retryTimer = null;
function scheduleRetry() {
  retryTimer ??= setTimeout(() => { retryTimer = null; retryResync(); }, 30000);
}
function retryResync() {
  resyncAndSettle().then(() => { if (offlineDirty && navigator.onLine !== false) scheduleRetry(); });
}

// オフライン起動後にネットワークが復帰したら同期を立ち上げ直す。
window.addEventListener('online', () => {
  if (!cloudSynced) { initCloudSync(); return; }
  // 初回 reconcile 前は送らない（マージ前のローカル state で全置換すると他端末の記録を消す・#313）。
  // オフライン中の state は古いので union してから送る（#358）。
  if (initialSyncDone) retryResync();
});
window.addEventListener('offline', () => { offlineDirty = true; });

// タブの表示状態に応じて省電力・取りこぼし防止を行う（#146）。
//   - 非アクティブ化: 取り消し待ちの削除を確定し（#398）、AudioContext を suspend（バッテリ節約）、
//     保留中のクラウド書き込みを flush（バックグラウンド/終了で消えないよう確定送信）。
//   - 復帰: AudioContext を resume（次の効果音に備える）、日付が変わっていれば描き直す。
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    applyPendingDelete();
    suspendAudio();
    cloud?.flushCloud();
  } else {
    resumeAudio();
    refreshOnNewDay();
    resyncAndSettle();            // 復帰時に最新クラウドを取り込んでから操作を受ける（#242）
  }
});
// 離脱直前（タブ閉じ・遷移）にも確定する。pagehide は visibilitychange より確実に発火する端末が
// あるため併用する。
window.addEventListener('pagehide', () => {
  applyPendingDelete();
  cloud?.flushCloud();
});

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
