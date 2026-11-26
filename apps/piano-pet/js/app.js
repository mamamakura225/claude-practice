import { createRouter, hashFromView, NAV_VIEWS } from './router.js';
import { escapeHtml, setText, downloadBlob } from './html.js';
import { loadState, saveState, normalizeLessonDates } from './storage.js';
import { state, setState, recomputed, onCommit } from './state.js';
import {
  initRecordScreen, buildSongColors, currentGoal, clearStampDraft, renderStampCard, resetRecordForm, startEditSession, hasUnsentInput,
} from './record-screen.js';
import { queueCloudPush, holdCloudPush, flushCloud, takeUnsentMark, resyncAndSettle, startCloudSync } from './cloud-sync.js';
import {
  todayStr, xpProgress, recomputeState, dailyProgress, mergeSameDaySessions, clampDailyGoal, checkBadges,
} from './game.js';
import { catMarkup, moodForState, playReaction, playCelebrate, playHiss, preloadTier, prefetchNextTier, tierFromBond, catImageSrc, CAT_STYLES, normalizeStyle, itemLayer } from './cat-image.js';
import { songTotals, normalizePraise, normalizeTempo } from './record-form.js';
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
  spentTotal,
} from './shop.js';
import { FOODS, foodById, canFeed, feedCat, affinity, affinityLevel, affinityRewards, bondCelebrateChance } from './feed.js';
import {
  isSoundOn, toggleSound, playSound, rollCatVoice, playCatVoice, unlockAudio, suspendAudio, resumeAudio,
} from './sound.js';
import { badgesWithStatus, earnedCount, newlyEarned, BADGES } from './badges.js';
import { catVideo, primeCatVideo, showCoinPopup, showFeedPopup, showBadgePopup } from './popups.js';
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
setState(loadState());

// 旧データに同日重複セッションがある場合は統合して再計算（統合そのものは recomputeState の入口）
if (mergeSameDaySessions(state.sessions) !== state.sessions) {
  setState(recomputed({}));
  saveState(state);
}

// 装備・配置していないアイテムの座標を itemLayout から除く（#168/#226 ゴーストデータ防止）。
// itemLayout は装着衣装と置物（#226）で共用するため、装備中 or 配置中のIDだけ残す。
function cleanItemLayout({ itemLayout, equippedItems, placedItems }) {
  const active = new Set([...equippedItems, ...placedItems]);
  return Object.fromEntries(Object.entries(itemLayout).filter(([id]) => active.has(id)));
}

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
  setState({ ...newState, pet: { ...newState.pet, itemLayout: cleanItemLayout(newState.pet) } });
  persist();                        // ローカルキャッシュ（オフライン用）
  // 当日分を消したら下書きも消す。残すと次に記録画面を開いたとき消した回数が戻り、二重に記録される
  if (deleted === todayStr() && !unsaved) clearStampDraft();
  queueCloudPush();
  renderHome();
  if (deleted && router.current === 'history') renderHistory();   // 連続日数・カレンダーも消したあとの姿に
}
onCommit(commitState);   // 分けたモジュール（record-screen.js 等）は state.js の commitState からここへ来る

// ===== ホームの猫表示 =====
function renderHome() {
  const stageEl = document.getElementById('catStage');
  if (stageEl) {
    const bond = affinityLevel(affinity(state)).level;
    stageEl.innerHTML = catMarkup({
      mood: moodForState(state, todayStr()),
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

// サウンドON/OFFトグルの表示を state に同期
function renderSoundToggle() {
  const btn = document.getElementById('soundToggle');
  if (!btn) return;
  const on = isSoundOn(state);
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? '🔊' : '🔇';
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
    if (view !== 'home') catVideo()?.then((m) => m?.stopClip(document.getElementById('catVideo'))).catch(() => {});
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
// 記録画面（record-screen.js）が使う画面の切り替え・きろくの描き直し・保存失敗の有無
initRecordScreen({ router, markNav, renderHistory, jumpToRecord, isUnsaved: () => unsaved });


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
document.getElementById('calPrevBtn')?.addEventListener('click', () => moveCalendar(-1));  // 練習カレンダー 前月（#236）
document.getElementById('calNextBtn')?.addEventListener('click', () => moveCalendar(1));   // 練習カレンダー 翌月
document.getElementById('photoBtn')?.addEventListener('click', shareCatPhoto);             // 写真モード（#237）

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
  setState({ ...state, sessions });
  state.badges = checkBadges(state);
  const gained = newlyEarned(prevBadges, state.badges);
  persist();
  queueCloudPush();
  renderHistory();
  if (gained.length) setTimeout(() => showBadgePopup(gained), 300);
}

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
  if (host && !host.contains(e.target)) catVideo()?.then((m) => m?.stopClip(host));
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
  setState({ ...state, pet: { ...state.pet, dailyGoal: goal } });
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
      holdCloudPush(UNDO_MS + 500);
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


// ===== せってい（親ゲートの内側）：設定オーバーレイを開くまで要らないので遅延読込（settings.js・#440） =====
// モーダル共通の操作（#397）も開くときまで要らないので遅延読込。閉じる側は開いた後なので読込済み。
let dialogMod = null;
const loadDialog = async () => (dialogMod ??= await import('./dialog.js'));

let settingsMod = null;
async function openSettings() {
  // アカウント切替・読み込み・初期化は reload を伴い、pagehide で別アカウントの保存先へ確定してしまう（#398）
  applyPendingDelete();
  settingsMod ??= await import('./settings.js').catch((err) => {   // 未キャッシュ＋回線断でだけ起きる
    console.warn('せっていを ひらけません（よみこみに しっぱい）', err);
    return null;
  });
  settingsMod?.openSettings({ clearStampDraft, currentGoal, showLessonSettings, showStampSettings });
}
document.getElementById('settingsToggle')?.addEventListener('click', openSettings);

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
window.addEventListener('hashchange', () => router.syncFromHash(window.location.hash));

// 初期表示
renderHome();
router.syncFromHash(window.location.hash);

// 前回の初期化・復元がクラウドへ届かなかったら一度だけ伝える（#384）
if (takeUnsentMark()) import('./backup.js').then((m) => window.alert(m.OVERWRITE_UNSENT_MESSAGE)).catch(() => {});

// 初回起動なら使い方の案内を出す（renderHome 後に重ねる）。画面は未表示のときだけ読む（#365）
if (!isOnboarded()) {
  import('./onboarding-ui.js')
    .then((m) => m.showOnboarding(catMarkup({ mood: 'idle', name: state.pet.name, style: state.pet.catStyle })))
    .catch(() => {});   // 読めなくても本体は動く（次の起動で出る）
}

// 表示中の画面を今の state で描き直す（記録画面は入力中の内容を持つので触らない）
function refreshView() {
  if (router.current === 'history') renderHistory();
  else if (router.current === 'shop') renderShop();
  else if (router.current === 'badges') renderBadges();
  else if (router.current === 'stamp' && !stampPressing) renderStampBook();
}

// 取り込んだ state に差し替えて、ホームと表示中の画面を描き直す
function adoptState(next) {
  setState(next);
  persist();                   // ローカルキャッシュも最新に
  renderHome();
  refreshView();
}

// タブの表示状態に応じて省電力・取りこぼし防止を行う（#146）。
//   - 非アクティブ化: 取り消し待ちの削除を確定し（#398）、AudioContext を suspend（バッテリ節約）、
//     保留中のクラウド書き込みを flush（バックグラウンド/終了で消えないよう確定送信）。
//   - 復帰: AudioContext を resume（次の効果音に備える）、日付が変わっていれば描き直す。
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    applyPendingDelete();
    suspendAudio();
    flushCloud();
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
  flushCloud();
});

// クラウド同期（cloud-sync.js）。休んでいた間のレッスン日は、クラウドを取り込んだあとで取りこむ（#242）
startCloudSync({
  adopt: adoptState,
  settled() {
    if (!lessonsDue) return;
    lessonsDue = false;
    creditDueLessons();
    refreshView();
  },
});

// ===== Service Worker 登録 =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // 登録失敗してもアプリ本体は動くので握りつぶす
    });
  });
}
