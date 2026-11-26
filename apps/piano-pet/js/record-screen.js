// ===== 記録画面：フォーム・スタンプの下書き・まとめモード・送信（#442 で app.js から分けた） =====
// 画面の切り替え・きろく画面の描き直しは app.js の仕事なので initRecordScreen で受け取る（app.js を import しない）。
import { state, commitState, recomputed } from './state.js';
import { escapeHtml, setText } from './html.js';
import { activeStorageKey } from './storage.js';
import { todayStr, applySession, crossedDailyGoal, clampDailyGoal, rollDailyBonus, hasUncreditedLesson } from './game.js';
import {
  isValidSession, collectSongs, MAX_ROW_COUNT, songsToRows, stampsToSongs, songsToStamps, combineSongs, pastSongNames, songTotals,
} from './record-form.js';
import { songColor, assignSongColors } from './song-color.js';
import { playSound, playStamp } from './sound.js';
import { newlyEarned } from './badges.js';
import { track } from './analytics.js';
import { flushCloud } from './cloud-sync.js';
import {
  celebrateRecord, playRewardPopups, showCoinPopup, showBadgePopup, showBonusPopup, showFreezePopup,
} from './popups.js';

// app.js から受け取るもの（initRecordScreen）
let router = null;
let markNav = null;
let renderHistory = null;
let jumpToRecord = null;
let isUnsaved = null;   // 端末への保存に失敗したままか（app.js の persist）
export function initRecordScreen(deps) {
  ({ router, markNav, renderHistory, jumpToRecord, isUnsaved } = deps);
}

// 既知の曲すべてに衝突回避込みで色を割り当てた Map を返す（#165）。
// 並びは累計回数順（songTotals）で決定的。extraNames に未保存の曲名（新規入力・
// チップ候補）を渡すと末尾に足して色を割り当てる。全画面でこのマップを基準にすれば
// 同じ曲が同じ色になり、近接ハッシュによる色かぶりも避けられる。
export function buildSongColors(extraNames = []) {
  const ordered = songTotals(state.sessions).map((t) => t.name);
  for (const n of extraNames) {
    const name = String(n ?? '').trim();
    if (name && !ordered.includes(name)) ordered.push(name);
  }
  return assignSongColors(ordered);
}

// 親が設定した1日の目標回数（#238）
export function currentGoal() {
  return clampDailyGoal(state.pet.dailyGoal);
}

document.getElementById('recordBackBtn')?.addEventListener('click', () => {
  if (editingDate != null) backToHistory();   // 「なおす」から来たら きろく の元の位置へ（#401）
  else router.go('home');
});
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
  if (isUnsaved()) return;   // 記録を端末に書けていない間は、確定前の下書きを残す（閉じると記録ごと失うため・#428）
  if (state.sessions.some((s) => s.date === todayStr())) { clearStampDraft(); return; }
  try {
    localStorage.setItem(STAMP_DRAFT_KEY, JSON.stringify({ date: todayStr(), stamps }));
  } catch { /* 保存できなくても致命的でないため無視 */ }
}

export function clearStampDraft() {
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
export function renderStampCard(fresh = false) {
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

export function resetRecordForm() {
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
export function startEditSession(date) {
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

// 記録の確定：保存・送信 → ホームへ → お祝い → ごほうびのポップアップ。
// 全再計算で確定した記録（同日統合 #186・過去日挿入 #260 等）は報酬の内訳が無いので、コインは前後の差を出す。
// increased: その日の回数が増えた記録か（同じ内容の再送信・減らした修正は false・#396）
function finishRecord(newState, totalCount, {
  increased = true, coins = Math.max(0, newState.pet.coins - state.pet.coins), bonus = 0, frozeDays = 0,
} = {}) {
  const prev = state;   // 目標到達（#227）・連続の節目（#305）は commitState（state 書換）より前と比べる
  const goal = currentGoal();
  commitState(newState);
  flushCloud();                   // 記録確定はバッチ境界。debounce を待たず即送信（#146）
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
      isHome: () => router.current === 'home',
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

export function hasUnsentInput() {
  if (editingDate != null || recordMode === 'batch') return true;
  // 復元した日なら保存済みの内容、それ以外（過去日）は空のカードから始まっている
  const saved = formDate() === restoredDate ? state.sessions.find((s) => s.date === restoredDate) : null;
  return JSON.stringify(stamps) !== JSON.stringify(songsToStamps(combineSongs(saved?.songs)));
}
