/* ===== Firebase ===== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import { getFirestore, doc, getDoc, getDocFromServer, setDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

/* ===== Utils ===== */
import { formatDate, isOverdue, addDays, addMonths, nextRecurrenceDeadline, todayStr, daysBetween, parseDateStr } from './utils/date.js';
import { normalizeTask, calculateSubtaskProgress } from './utils/task.js';
import { escHtml } from './utils/html.js';
import { filterTasks } from './utils/filter.js';
import { sortTasks, PRIORITY_ORDER } from './utils/sort.js';
import { mergeFallbackChanges } from './utils/sync.js';
import { safeColor, tint, readableTextColor } from './utils/color.js';

/* ===== エラー監視・利用計測（任意・キー未設定なら no-op） ===== */
import { initErrorMonitoring } from './sentry.js';
import { initAnalytics, track } from './analytics.js';
initErrorMonitoring(); // 早期にグローバルエラーハンドラを張る
initAnalytics();

const fbApp   = initializeApp(firebaseConfig);
const db      = getFirestore(fbApp);
const DATA_DOC = doc(db, 'dtask', 'data');

/* ===== State ===== */
const state = {
  tasks: [],
  categories: [],
  currentView: 'list',
  filters: {
    categoryId: '',
    priority: '',
    status: '',
    sort: 'manual',
    search: '',
    hideCompleted: false,
    preset: 'today', // 起動既定は「今日やること」。'', 'today', 'week', 'overdue'
  },
  theme: 'light',
};

/* ===== UI-only state (not persisted to cloud) ===== */
const uiState = {
  expanded: new Set(), // taskId set: インライン展開中のタスク
};

/* ===== Swipe Gesture State ===== */
const SWIPE_THRESHOLD    = 40;
const SWIPE_AUTO_TRIGGER = 100;
const swipeState = {
  active: false, startX: 0, startY: 0, currentX: 0,
  card: null, wrapper: null, id: null, canceled: false,
};
let swipeDidMove = false;

/* ===== Storage ===== */
const THEME_KEY     = 'dtask_theme';
const FONTSIZE_KEY  = 'dtask_fontsize';
const EXPANDED_KEY  = 'dtask_expanded';
const VIEW_KEY      = 'dtask_view'; // 'list' | 'kanban'（ビュー形式のみ復元。preset は毎回 today 固定）
const HINT_KEY      = 'dtask_hint_actions'; // 操作メニュー(⋮)の初回ヒント表示済みフラグ

// 文言は .sync-label に入れる。スマホ幅ではアイコンだけ見せて文言は読み上げ用に残す（ヘッダーからはみ出さない #353）
const SYNC_STATES = {
  idle:    { html: '' },
  syncing: { html: '<span class="sync-dot" aria-hidden="true"></span><span class="sync-label">同期中…</span>' },
  saved:   { html: '<span aria-hidden="true">✓</span><span class="sync-label"> 保存済み</span>' },
  error:   { html: '<span aria-hidden="true">⚠</span><span class="sync-label"> 保存失敗</span> <button class="sync-retry-btn" type="button" data-action="sync-retry">再試行</button>' },
  offline: { html: '<span aria-hidden="true">📵</span><span class="sync-label"> オフライン</span>' },
  // 未同期はオフライン（📵）と別アイコン・別背景にし、アイコンだけのスマホ幅でも区別できるようにする
  local:   { html: '<span aria-hidden="true">💾</span><span class="sync-label"> 未同期（この端末に保存中）</span>' },
  // 送信が長く終わらない（端末はオンライン扱いだがサーバーに届かない）とき。SDK が接続回復後に送る (#354)
  pending: { html: '<span aria-hidden="true">⏳</span><span class="sync-label"> 送信待ち（接続を待っています）</span>' },
};
const SYNC_PENDING_MS = 10_000;
let syncIdleTimer = null;
let currentSyncState = 'idle';
let lastSaveFailed = false; // 保存失敗が未解決（再試行導線を回線の出入りで消さないため）

/* クラウドの最新を読めていない間（起動時フォールバック中・オフライン編集後）は setDoc しない。
 * setDoc はドキュメント全体の置換なので、空や古いローカル状態で書くとクラウドの全件が消える (#349)。
 * fallbackBaseline は「最後にクラウドと一致していた状態」(dtask_synced) で、クラウド到着時の差分マージに使う。 */
const SYNCED_KEY = 'dtask_synced';
let cloudLoaded = false;
let fallbackBaseline = null;

function snapshotData(tasks = state.tasks, categories = state.categories) {
  return JSON.parse(JSON.stringify({ tasks, categories }));
}

function saveLocalMirror() {
  try {
    localStorage.setItem('dtask_tasks', JSON.stringify(state.tasks));
    localStorage.setItem('dtask_categories', JSON.stringify(state.categories));
  } catch {}
}

function saveSynced(data) {
  try { localStorage.setItem(SYNCED_KEY, JSON.stringify(data)); } catch {}
}

/* 未同期モードへ入る。基準はクラウド一致状態。それが無い端末（本修正の初回）は現在のローカルを基準として
 * 保存し、再起動して再びフォールバックしても未同期の変更を差分として検出できるようにする */
function enterUnsynced() {
  cloudLoaded = false;
  let synced = null;
  try { synced = JSON.parse(localStorage.getItem(SYNCED_KEY)); } catch {}
  if (!synced || !Array.isArray(synced.tasks)) {
    synced = snapshotData();
    saveSynced(synced);
  }
  fallbackBaseline = synced;
}

function setSyncState(stateName) {
  const el = document.getElementById('syncIndicator');
  if (!el) return;
  clearTimeout(syncIdleTimer);
  currentSyncState = stateName;
  el.className = `sync-indicator sync-${stateName}`;
  el.innerHTML = SYNC_STATES[stateName].html;
  if (stateName === 'saved') {
    syncIdleTimer = setTimeout(() => setSyncState('idle'), 2000);
  }
}

async function saveCloud() {
  saveLocalMirror();
  if (!cloudLoaded) {
    setSyncState('local');
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    // オフライン中の編集は、復帰後にクラウド最新へ差分マージしてから書く（復帰直後の全件置換で他端末の変更を消さない）
    enterUnsynced();
    setSyncState('offline');
    return;
  }
  if (currentSyncState !== 'pending') setSyncState('syncing'); // 送信待ち中の追加編集で「同期中」へ戻してちらつかせない
  // 保存ごとに確定を待つ。Firestore は順に確定を返すので、古い保存が未確定なら後続も未確定＝連続編集中でも「送信待ち」を出せる
  let settled = false;
  const pendingTimer = setTimeout(() => {
    if (!settled && currentSyncState === 'syncing') setSyncState('pending');
  }, SYNC_PENDING_MS);
  // dtask_synced はここでは更新しない（他端末の変更を含むスナップショットとの順序が保証されないため）。
  // 書込み確認は includeMetadataChanges の onSnapshot（!hasPendingWrites）で届き、そこで更新する
  try {
    await setDoc(DATA_DOC, snapshotData());
    settled = true;
    clearTimeout(pendingTimer);
    lastSaveFailed = false;
    if (cloudLoaded) setSyncState('saved'); // 送信中にオフライン化して未同期へ入っていたら表示を上書きしない
  } catch (err) {
    settled = true;
    clearTimeout(pendingTimer);
    console.error('saveCloud failed', err);
    lastSaveFailed = true;
    setSyncState('error');
  }
}

async function loadStorage() {
  state.theme = localStorage.getItem(THEME_KEY) || 'light';

  // Firestore が応答しない場合（オフライン等）でも UI を起動できるよう 5 秒でタイムアウト
  let snap;
  try {
    snap = await Promise.race([
      getDoc(DATA_DOC),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 5000)),
    ]);
  } catch (err) {
    console.warn('Firestore unavailable, falling back to localStorage', err);
    try {
      state.tasks      = JSON.parse(localStorage.getItem('dtask_tasks'))      || [];
      state.categories = JSON.parse(localStorage.getItem('dtask_categories')) || [];
    } catch {
      state.tasks = []; state.categories = [];
    }
    state.tasks = state.tasks.map(normalizeTask);
    enterUnsynced();
    loadExpanded();
    return;
  }

  cloudLoaded = true;
  if (snap.exists()) {
    const d = snap.data();
    state.tasks      = (d.tasks      || []).map(normalizeTask);
    state.categories = d.categories || [];
    saveLocalMirror();
    saveSynced(snapshotData());
  } else {
    saveSynced({ tasks: [], categories: [] }); // クラウドは空＝これが基準
    // 初回: localStorageにデータがあればFirestoreへ移行
    try {
      state.tasks      = JSON.parse(localStorage.getItem('dtask_tasks'))      || [];
      state.categories = JSON.parse(localStorage.getItem('dtask_categories')) || [];
    } catch {
      state.tasks = []; state.categories = [];
    }
    state.tasks = state.tasks.map(normalizeTask);
    if (state.tasks.length || state.categories.length) await saveCloud();
  }
  loadExpanded();
}

/* ===== UI state persistence (展開状態) ===== */
function loadExpanded() {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    const aliveIds = new Set(state.tasks.map(t => t.id));
    uiState.expanded = new Set(arr.filter(id => aliveIds.has(id)));
  } catch {
    uiState.expanded = new Set();
  }
}
function saveExpanded() {
  // 削除済みタスクの ID を同時にクリーンアップ
  const aliveIds = new Set(state.tasks.map(t => t.id));
  const arr = [...uiState.expanded].filter(id => aliveIds.has(id));
  uiState.expanded = new Set(arr);
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(arr)); } catch {}
}

/* ===== Font size (標準 / 大) ===== */
function applyFontSize(size) {
  const normalized = size === 'large' ? 'large' : 'standard';
  document.body.dataset.fontsize = normalized;
  localStorage.setItem(FONTSIZE_KEY, normalized);
  document.querySelectorAll('.fontsize-btn').forEach(btn => {
    const isActive = btn.dataset.fontsize === normalized;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

/* ===== Theme ===== */
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  const icon  = btn.querySelector('.theme-toggle-icon');
  const label = btn.querySelector('.theme-toggle-label');
  if (icon)  icon.textContent  = theme === 'dark' ? '☀️' : '🌙';
  if (label) label.textContent = theme === 'dark' ? 'ライト' : 'ダーク';
  btn.setAttribute('aria-label', theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え');
  btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(state.theme);
}

/* ===== Utility ===== */
function uid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}


const RECURRENCE_LABEL = { daily: '毎日', weekly: '毎週', monthly: '毎月' };

const PRIORITY_LABEL = { high: '高', medium: '中', low: '低' };
const STATUS_LABEL   = { todo: '未着手', inprogress: '進行中', done: '完了' };

/* ===== Undo stack (Ctrl+Z / Cmd+Z) =====
   showToast に渡された undoFn を保持して、トーストが消えた後でも
   キーボードショートカットで実行できるようにする。
   - 保持期間: 60秒（トーストの可視時間 5秒より長い）
   - 最大件数: 5 件（古いものから捨てる）
*/
const UNDO_TTL_MS = 60_000;
const UNDO_STACK_MAX = 5;
const undoStack = [];

function pushUndo(fn) {
  if (typeof fn !== 'function') return;
  undoStack.push({ fn, expiresAt: Date.now() + UNDO_TTL_MS });
  if (undoStack.length > UNDO_STACK_MAX) undoStack.shift();
}

function consumeUndoFn(fn) {
  const idx = undoStack.findIndex(entry => entry.fn === fn);
  if (idx >= 0) undoStack.splice(idx, 1);
}

function triggerLatestUndo() {
  const now = Date.now();
  while (undoStack.length && undoStack[0].expiresAt < now) undoStack.shift();
  const entry = undoStack.pop();
  if (!entry) return false;
  try { entry.fn(); } catch (err) { console.error('Undo failed:', err); }
  return true;
}

/* ===== Toast (with optional Undo) ===== */
function showToast(message, undoFn, duration = 5000, action = null) {
  const container = document.getElementById('toastContainer');
  if (!container) return () => {};

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');

  const msgEl = document.createElement('span');
  msgEl.className = 'toast-message';
  msgEl.textContent = message;
  toast.appendChild(msgEl);

  let dismissed = false;
  let timer;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    toast.classList.add('toast-out');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    // 念のためフォールバック
    setTimeout(() => toast.remove(), 600);
  }

  if (undoFn) {
    pushUndo(undoFn);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-undo';
    btn.textContent = '元に戻す';
    btn.addEventListener('click', () => {
      consumeUndoFn(undoFn);
      undoFn();
      dismiss();
    });
    toast.appendChild(btn);
  }
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-undo';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { action.fn(); dismiss(); });
    toast.appendChild(btn);
  }

  container.appendChild(toast);
  // entrance animation trigger
  requestAnimationFrame(() => toast.classList.add('toast-in'));
  timer = setTimeout(dismiss, duration);
  // ホバー中・フォーカス中は消さない（キーボードでボタンまで辿り着く時間を確保する）
  const pause  = () => clearTimeout(timer);
  const resume = () => { if (!dismissed) timer = setTimeout(dismiss, duration); };
  toast.addEventListener('mouseenter', pause);
  toast.addEventListener('focusin', pause);
  toast.addEventListener('mouseleave', () => { if (!toast.contains(document.activeElement)) resume(); });
  toast.addEventListener('focusout', e => { if (!toast.contains(e.relatedTarget)) resume(); });
  return dismiss;
}

/* ===== Task CRUD ===== */
function addTask(data) {
  const task = normalizeTask({ id: uid(), createdAt: new Date().toISOString(), ...data });
  state.tasks.push(task);
  saveCloud();
  render();
  // 絞り込みで見えないタスクを足すと「何も起きなかった」ように見えるため、理由と戻り道を出す (#352)
  if (!getFilteredTasks().some(t => t.id === task.id)) {
    showToast(`「${task.title}」を追加しました（今の絞り込みでは表示されません）`, undefined, 7000,
      { label: 'すべて表示', fn: clearFilters });
  }
  // 操作種別と頻度のみ計測（内容は送らない）
  track('task_added', { priority: data.priority || 'medium', hasDeadline: !!data.deadline });
}

function updateTask(id, data) {
  const idx = state.tasks.findIndex(t => t.id === id);
  if (idx < 0) return;
  const prevStatus = state.tasks[idx].status;
  state.tasks[idx] = { ...state.tasks[idx], ...data };
  spawnNextIfNeeded(state.tasks[idx], prevStatus);
  saveCloud();
  render();
}

function deleteTask(id) {
  const idx = state.tasks.findIndex(t => t.id === id);
  if (idx < 0) return;
  const removed = state.tasks[idx];

  const finalize = () => {
    state.tasks = state.tasks.filter(t => t.id !== id);
    saveCloud();
    render();
    showToast(`「${removed.title}」を削除しました`, () => {
      const exists = state.tasks.some(t => t.id === removed.id);
      if (exists) return;
      state.tasks.splice(Math.min(idx, state.tasks.length), 0, removed);
      saveCloud();
      render();
    });
  };

  const card = document.querySelector(`.task-card[data-id="${id}"], .kanban-card[data-id="${id}"]`);
  if (card) {
    card.classList.add('removing');
    setTimeout(finalize, 230);
  } else {
    finalize();
  }
}

function toggleDone(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const prevStatus = task.status;
  task.status = task.status === 'done' ? 'todo' : 'done';
  spawnNextIfNeeded(task, prevStatus);
  saveCloud();
  render();
}


function spawnNextRecurrence(task) {
  const { spawnedNextId, ...rest } = task;
  // 毎月は元の「日」を anchorDay として引き継ぐ（1/31 → 2/28 → 3/31。月末で詰めた日に引きずられない #351）
  const recurrence = task.recurrence.type === 'monthly' && /^\d{4}-\d{2}-\d{2}$/.test(task.deadline || '')
    ? { ...task.recurrence, anchorDay: task.recurrence.anchorDay ?? parseDateStr(task.deadline).getDate() }
    : task.recurrence;
  const next = normalizeTask({
    ...rest,
    id: uid(),
    createdAt: new Date().toISOString(),
    status: 'todo',
    recurrence,
    deadline: nextRecurrenceDeadline(task.deadline, recurrence),
    subtasks: (task.subtasks || []).map(s => ({ ...s, id: uid(), done: false })),
  });
  state.tasks.push(next);
  return next;
}

/* 繰り返しの次回分は「未完了→完了」になったときだけ1件作る。✓・⋮・Kanbanセレクト・D&D・編集モーダルの
 * 全経路で共通 (#351)。完了→未完了→完了と戻しても、前回作った次回分が残っていれば作らない */
function existingNext(task) {
  return task.spawnedNextId ? state.tasks.find(t => t.id === task.spawnedNextId) || null : null;
}

function spawnNextIfNeeded(task, prevStatus) {
  if (prevStatus === 'done' || task.status !== 'done' || !task.recurrence?.type) return null;
  if (existingNext(task)) return null;
  const next = spawnNextRecurrence(task);
  task.spawnedNextId = next.id;
  return next;
}

function skipRecurrence(id) {
  const idx = state.tasks.findIndex(t => t.id === id);
  if (idx < 0) return;
  const original = state.tasks[idx];
  if (!original.recurrence || !original.recurrence.type) return;

  // 一度完了→未完了に戻したタスクは次回分が既にあるので、作らずに今回分だけ外す
  const spawned = existingNext(original) ? null : spawnNextRecurrence(original);
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveCloud();
  render();

  const dateLabel = formatDate(original.deadline) || '今回分';
  showToast(`「${original.title}」を${dateLabel}スキップしました`, () => {
    if (spawned) state.tasks = state.tasks.filter(t => t.id !== spawned.id); // 自動生成された次回分を取消
    if (!state.tasks.some(t => t.id === original.id)) {
      state.tasks.splice(Math.min(idx, state.tasks.length), 0, original);
    }
    saveCloud();
    render();
  });
}

/* ===== Category CRUD ===== */
function addCategory(name, color) {
  state.categories.push({ id: uid(), name, color });
  saveCloud();
  renderSidebar();
  populateCategorySelect();
}

function deleteCategory(id) {
  const idx = state.categories.findIndex(c => c.id === id);
  if (idx < 0) return;
  const removed       = state.categories[idx];
  const affectedIds   = state.tasks.filter(t => t.categoryId === id).map(t => t.id);
  const wasFiltered   = state.filters.categoryId === id;

  state.categories.splice(idx, 1);
  state.tasks.forEach(t => { if (t.categoryId === id) t.categoryId = ''; });
  if (wasFiltered) state.filters.categoryId = '';
  saveCloud();
  renderSidebar();
  populateCategorySelect();
  render();

  const msg = affectedIds.length
    ? `プロジェクト「${removed.name}」を削除（${affectedIds.length}件のタスクが「なし」になりました）`
    : `プロジェクト「${removed.name}」を削除しました`;
  showToast(msg, () => {
    if (state.categories.some(c => c.id === removed.id)) return;
    state.categories.splice(Math.min(idx, state.categories.length), 0, removed);
    const affectedSet = new Set(affectedIds);
    state.tasks.forEach(t => { if (affectedSet.has(t.id)) t.categoryId = id; });
    if (wasFiltered) state.filters.categoryId = id;
    saveCloud();
    renderSidebar();
    populateCategorySelect();
    render();
  });
}

function getCategoryById(id) {
  return state.categories.find(c => c.id === id) || null;
}

/* ===== Filter & Sort ===== */
function getFilteredTasks() {
  const today = todayStr();
  const filtered = filterTasks(state.tasks, state.filters, today);
  return sortTasks(filtered, state.filters.sort);
}

/* ===== Badge HTML ===== */
function priorityBadgeHtml(priority) {
  return `<span class="badge badge-${priority}">${PRIORITY_LABEL[priority] || priority}</span>`;
}

const CARD_SURFACE = { light: '#FFFFFF', dark: '#1A1D27' }; // style.css の --card-bg と一致させる

function categoryBadgeHtml(categoryId) {
  const cat = getCategoryById(categoryId);
  if (!cat) return '';
  // ユーザーが選んだ色でも読めるよう、ライト/ダークそれぞれのカード面に対して AA を満たす色を算出し、
  // CSS 変数で渡す（テーマ切替は CSS 側で行い、再描画しない #354）
  const vars = [['l', CARD_SURFACE.light], ['d', CARD_SURFACE.dark]]
    .map(([k, surface]) => `--cat-bg-${k}:${tint(cat.color, surface, 0.13)};--cat-fg-${k}:${readableTextColor(cat.color, surface, 0.13)}`)
    .join(';');
  return `<span class="badge badge-category" style="${vars}">${escHtml(cat.name)}</span>`;
}

function deadlineBadgeHtml(deadline) {
  if (!deadline) return '';
  const over = isOverdue(deadline);
  return `<span class="badge-deadline${over ? ' overdue' : ''}">📅 ${formatDate(deadline)}${over ? ' (期限切れ)' : ''}</span>`;
}

function tagChipsHtml(tags) {
  if (!tags || tags.length === 0) return '';
  return tags.map(t => `<span class="tag-chip">#${escHtml(t)}</span>`).join('');
}

function recurrenceBadgeHtml(recurrence) {
  if (!recurrence || !recurrence.type) return '';
  return `<span class="badge-recurrence">🔁 ${RECURRENCE_LABEL[recurrence.type] || recurrence.type}</span>`;
}

function subtaskProgressHtml(subtasks, taskId, expanded) {
  const { total, done, percent } = calculateSubtaskProgress(subtasks);
  // taskId 省略時（後方互換）：0件は非表示、それ以外は非インタラクティブな span
  if (!taskId) {
    if (total === 0) return '';
    return `<span class="subtask-progress" title="サブタスク進捗">
      <span class="subtask-progress-bar"><span class="subtask-progress-fill" style="width:${percent}%"></span></span>
      <span class="subtask-progress-text">${done}/${total}</span>
    </span>`;
  }
  // 0件：追加導線ボタン（クリックで展開＋入力フォーカス）
  if (total === 0) {
    return `<button type="button" class="subtask-progress subtask-toggle subtask-toggle-empty"
      data-action="add-subtask-empty" data-id="${taskId}"
      title="サブタスクを追加">＋ サブタスク</button>`;
  }
  const inner = `<span class="subtask-progress-bar"><span class="subtask-progress-fill" style="width:${percent}%"></span></span>
    <span class="subtask-progress-text">${done}/${total}</span>`;
  return `<button type="button" class="subtask-progress subtask-toggle"
    data-action="toggle-subtasks" data-id="${taskId}"
    aria-expanded="${expanded ? 'true' : 'false'}"
    aria-controls="subtasks-${taskId}"
    title="サブタスクを開閉">${inner}<span class="chevron" aria-hidden="true">▾</span></button>`;
}

/* ===== Render: List View ===== */
function renderListView() {
  const container = document.getElementById('taskList');
  const empty     = document.getElementById('listEmpty');
  const tasks     = getFilteredTasks();

  // remove old cards (keep empty state)
  container.querySelectorAll('.swipe-wrapper, .task-card').forEach(el => el.remove());

  if (tasks.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  tasks.forEach((task, index) => {
    const card = document.createElement('div');
    card.className = `task-card${task.status === 'done' ? ' done-card' : ''}`;
    card.dataset.id = task.id;
    card.style.setProperty('--card-i', `${index * 45}ms`);

    const titleText = escHtml(task.title);
    const isDone = task.status === 'done';
    card.innerHTML = `
      <button type="button" class="task-check${isDone ? ' checked' : ''}" data-action="toggle" data-id="${task.id}" title="完了切り替え" aria-pressed="${isDone ? 'true' : 'false'}" aria-label="完了状態を切り替え: ${titleText}"></button>
      <div class="task-body">
        <div class="task-title">${titleText}</div>
        ${task.description ? `<div class="task-desc">${escHtml(task.description)}</div>` : ''}
        <div class="task-meta">
          ${priorityBadgeHtml(task.priority)}
          ${categoryBadgeHtml(task.categoryId)}
          ${deadlineBadgeHtml(task.deadline)}
          ${recurrenceBadgeHtml(task.recurrence)}
          ${subtaskProgressHtml(task.subtasks, task.id, uiState.expanded.has(task.id))}
          <span class="badge badge-status badge-status-${task.status}">${STATUS_LABEL[task.status] || task.status}</span>
        </div>
        ${task.tags && task.tags.length ? `<div class="task-tags">${tagChipsHtml(task.tags)}</div>` : ''}
        ${uiState.expanded.has(task.id)
          ? `<div class="task-subtasks-inline" id="subtasks-${task.id}" role="group" aria-label="サブタスク">
              ${(task.subtasks || []).map(s => `
                <div class="subtask-inline-row">
                  <input type="checkbox" class="subtask-inline-check"
                         data-action="toggle-subtask" data-id="${task.id}" data-sid="${s.id}"
                         ${s.done ? 'checked' : ''}
                         aria-label="サブタスク完了切り替え: ${escHtml(s.title)}">
                  <span class="subtask-inline-title${s.done ? ' done' : ''}"
                        data-action="edit-subtask" data-id="${task.id}" data-sid="${s.id}"
                        role="button" tabindex="0"
                        title="クリックで編集"
                        aria-label="サブタスクを編集: ${escHtml(s.title)}">${escHtml(s.title)}</span>
                </div>
              `).join('')}
              <button type="button" class="subtask-inline-add"
                      data-action="add-subtask" data-id="${task.id}"
                      title="サブタスクを追加">＋ サブタスク追加</button>
            </div>`
          : ''}
      </div>
      <div class="task-actions">
        ${task.recurrence?.type && task.status !== 'done' ? `<button class="btn-action skip" data-action="skip" data-id="${task.id}" title="今回だけスキップ（次回分は維持）" aria-label="今回だけスキップ: ${titleText}">⏭</button>` : ''}
        <button class="btn-action" data-action="edit" data-id="${task.id}" title="編集" aria-label="編集: ${titleText}">✏️</button>
        <button class="btn-action delete" data-action="delete" data-id="${task.id}" title="削除" aria-label="削除: ${titleText}">🗑️</button>
      </div>
      <button type="button" class="card-menu-btn" data-action="card-menu" data-id="${task.id}" title="操作メニュー" aria-label="操作メニュー: ${titleText}" aria-haspopup="menu" aria-expanded="false">⋮</button>
    `;
    // .task-card を .swipe-wrapper で包む
    const wrapper = document.createElement('div');
    wrapper.className = 'swipe-wrapper';
    const bgComplete = document.createElement('div');
    bgComplete.className = 'swipe-bg-complete';
    bgComplete.textContent = '✓';
    const bgDelete = document.createElement('div');
    bgDelete.className = 'swipe-bg-delete';
    bgDelete.textContent = '🗑';
    wrapper.appendChild(bgComplete);
    wrapper.appendChild(bgDelete);
    wrapper.appendChild(card);
    container.appendChild(wrapper);
    // スワイプリスナーをカードに直接付与
    attachSwipeListeners(card, wrapper, task.id);
    // D&Dハンドラ (デスクトップのみ)
    attachCardDragHandlers(card);
  });
}

/* ===== Render: Kanban View ===== */
function renderKanbanView() {
  const columns = { todo: [], inprogress: [], done: [] };
  getFilteredTasks().forEach(t => {
    if (columns[t.status]) columns[t.status].push(t);
    else columns.todo.push(t);
  });

  ['todo', 'inprogress', 'done'].forEach(status => {
    const container = document.getElementById(`${status}Cards`);
    const countEl   = document.getElementById(`${status}Count`);
    const prevCount = parseInt(countEl.textContent, 10);
    container.innerHTML = '';
    const newCount = columns[status].length;
    countEl.textContent = newCount;
    if (newCount !== prevCount) {
      countEl.classList.remove('bump');
      void countEl.offsetWidth; // reflow to restart animation
      countEl.classList.add('bump');
    }

    columns[status].forEach((task, index) => {
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.dataset.id = task.id;
      card.style.setProperty('--card-i', `${index * 40}ms`);

      const statusOptions = Object.entries(STATUS_LABEL).map(([v, l]) =>
        `<option value="${v}"${task.status === v ? ' selected' : ''}>${l}</option>`
      ).join('');

      const kTitleText = escHtml(task.title);
      card.innerHTML = `
        <div class="kanban-card-title">${kTitleText}</div>
        <div class="kanban-card-meta">
          ${priorityBadgeHtml(task.priority)}
          ${categoryBadgeHtml(task.categoryId)}
          ${deadlineBadgeHtml(task.deadline)}
          ${recurrenceBadgeHtml(task.recurrence)}
          ${subtaskProgressHtml(task.subtasks, task.id, uiState.expanded.has(task.id))}
        </div>
        ${task.tags && task.tags.length ? `<div class="kanban-card-tags">${tagChipsHtml(task.tags)}</div>` : ''}
        ${uiState.expanded.has(task.id)
          ? `<div class="task-subtasks-inline kanban-subtasks-inline" id="subtasks-${task.id}" role="group" aria-label="サブタスク">
              ${(task.subtasks || []).map(s => `
                <div class="subtask-inline-row">
                  <input type="checkbox" class="subtask-inline-check"
                         data-action="toggle-subtask" data-id="${task.id}" data-sid="${s.id}"
                         ${s.done ? 'checked' : ''}
                         aria-label="サブタスク完了切り替え: ${escHtml(s.title)}">
                  <span class="subtask-inline-title${s.done ? ' done' : ''}"
                        data-action="edit-subtask" data-id="${task.id}" data-sid="${s.id}"
                        role="button" tabindex="0"
                        title="クリックで編集"
                        aria-label="サブタスクを編集: ${escHtml(s.title)}">${escHtml(s.title)}</span>
                </div>
              `).join('')}
              <button type="button" class="subtask-inline-add"
                      data-action="add-subtask" data-id="${task.id}"
                      title="サブタスクを追加">＋ サブタスク追加</button>
            </div>`
          : ''}
        <div class="kanban-card-footer">
          <label class="visually-hidden" for="kanban-status-${task.id}">${kTitleText} のステータス</label>
          <select id="kanban-status-${task.id}" class="kanban-status-select" data-action="status" data-id="${task.id}">${statusOptions}</select>
          <div class="kanban-actions">
            ${task.recurrence?.type && task.status !== 'done' ? `<button class="btn-action skip" data-action="skip" data-id="${task.id}" title="今回だけスキップ" aria-label="今回だけスキップ: ${kTitleText}">⏭</button>` : ''}
            <button class="btn-action" data-action="edit" data-id="${task.id}" title="編集" aria-label="編集: ${kTitleText}">✏️</button>
            <button class="btn-action delete" data-action="delete" data-id="${task.id}" title="削除" aria-label="削除: ${kTitleText}">🗑️</button>
            <button type="button" class="btn-action card-menu-btn" data-action="card-menu" data-id="${task.id}" title="操作メニュー" aria-label="操作メニュー: ${kTitleText}" aria-haspopup="menu" aria-expanded="false">⋮</button>
          </div>
        </div>
      `;
      container.appendChild(card);
      attachCardDragHandlers(card);
    });
  });
}

/* ===== Render: Sidebar ===== */
function renderSidebar() {
  // Category filter chips
  const filterEl = document.getElementById('categoryFilter');
  const allActive = state.filters.categoryId === '';
  filterEl.innerHTML = `<button type="button" class="category-chip${allActive ? ' active' : ''}" data-category-id="" aria-pressed="${allActive ? 'true' : 'false'}">すべて</button>`;
  state.categories.forEach(cat => {
    const btn = document.createElement('button');
    const active = state.filters.categoryId === cat.id;
    btn.type = 'button';
    btn.className = `category-chip${active ? ' active' : ''}`;
    btn.dataset.categoryId = cat.id;
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.innerHTML = `<span class="category-dot" style="background:${safeColor(cat.color)}" aria-hidden="true"></span>${escHtml(cat.name)}`;
    filterEl.appendChild(btn);
  });

  // Category manage list
  const manageEl = document.getElementById('categoryList');
  manageEl.innerHTML = '';
  state.categories.forEach(cat => {
    const item = document.createElement('div');
    item.className = 'category-manage-item';
    item.innerHTML = `
      <span class="category-dot" style="background:${safeColor(cat.color)}" aria-hidden="true"></span>
      <span class="category-manage-name">${escHtml(cat.name)}</span>
      <button type="button" class="btn-delete-cat" data-action="delete-cat" data-id="${cat.id}" title="削除" aria-label="プロジェクトを削除: ${escHtml(cat.name)}">✕</button>
    `;
    manageEl.appendChild(item);
  });

  // ヘッダーの現在プロジェクトバッジ更新
  const badge = document.getElementById('currentProjectBadge');
  const activeCat = state.categories.find(c => c.id === state.filters.categoryId);
  if (activeCat) {
    document.getElementById('currentProjectDot').style.background = safeColor(activeCat.color);
    document.getElementById('currentProjectName').textContent = activeCat.name;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

/* ===== Render: Task modal category select ===== */
function populateCategorySelect() {
  const sel = document.getElementById('taskCategory');
  const cur = sel.value;
  sel.innerHTML = '<option value="">なし</option>';
  state.categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    sel.appendChild(opt);
  });
  if (cur) sel.value = cur;
}

/* ===== Render: Stats Bar ===== */
function renderStats() {
  const el = document.getElementById('statsBar');
  if (!el) return;
  const all = getFilteredTasks();
  const total = all.length;
  if (total === 0) { el.style.display = 'none'; return; }
  const done = all.filter(t => t.status === 'done').length;
  const pct = Math.round((done / total) * 100);
  el.style.display = '';
  document.getElementById('statsText').textContent = `${done} / ${total} 完了`;
  document.getElementById('statsPct').textContent = `${pct}%`;
  const bar = document.getElementById('statsProgressBar');
  bar.style.width = '0%';
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = `${pct}%`; }));
}

/* ===== Today home: 達成（ご褒美）空状態 ===== */
function nextDeadlineInfo() {
  const today = todayStr();
  const upcoming = state.tasks
    .filter(t => t.status !== 'done' && t.deadline && t.deadline > today)
    .map(t => t.deadline)
    .sort();
  if (!upcoming.length) return null;
  const next = upcoming[0];
  const days = daysBetween(today, next);
  return { date: next, days };
}

function renderTodayDone(el) {
  const info = nextDeadlineInfo();
  const sub = info
    ? `次の締切は <strong>${formatDate(info.date)}</strong>（${info.days}日後）です。`
    : '次の締切はありません ☕ ゆっくり休みましょう。';
  el.innerHTML = `
    <div class="empty-icon" aria-hidden="true">🎉</div>
    <p class="today-done-title">今日のタスクは完了！</p>
    <p class="empty-sub">${sub}</p>
  `;
}

/* 達成画面 / 通常ビューの出し分け（ビュー非依存）。
   preset==='today' かつ「今日対象タスクはあるが全て完了」のときご褒美画面を出す。
   今日対象が元々0件（新規ユーザー等）は各ビュー既存の汎用空状態に委ねる。 */
function applyHomeState(showReward) {
  const todayDone  = document.getElementById('todayDoneState');
  const listView   = document.getElementById('listView');
  const kanbanView = document.getElementById('kanbanView');
  if (showReward) {
    renderTodayDone(todayDone);
    todayDone.classList.remove('hidden');
    listView.classList.add('hidden');
    kanbanView.classList.add('hidden');
  } else {
    todayDone.classList.add('hidden');
    listView.classList.toggle('hidden',   state.currentView !== 'list');
    kanbanView.classList.toggle('hidden', state.currentView !== 'kanban');
  }
}

/* ===== Render (full) ===== */
function render() {
  closeCardMenu(); // 再描画でトリガー要素が差し替わるため開いていれば閉じる
  renderStats();
  const todayTasks = getFilteredTasks();
  const showReward = state.filters.preset === 'today' &&
    todayTasks.length > 0 && todayTasks.every(t => t.status === 'done');
  applyHomeState(showReward);
  if (state.currentView === 'list') renderListView();
  else renderKanbanView();
}

/* ===== Modal: Subtask rows ===== */
function appendSubtaskRow(subtask = { id: uid(), title: '', done: false }) {
  const list = document.getElementById('subtaskList');
  const row = document.createElement('div');
  row.className = 'subtask-row';
  row.dataset.id = subtask.id;
  row.innerHTML = `
    <input type="checkbox" class="subtask-check" ${subtask.done ? 'checked' : ''} aria-label="サブタスクを完了に切り替え">
    <input type="text" class="subtask-title-input" value="${escHtml(subtask.title)}" placeholder="サブタスクのタイトル" aria-label="サブタスクのタイトル">
    <button type="button" class="subtask-remove-btn" title="削除" aria-label="サブタスクを削除">✕</button>
  `;
  row.querySelector('.subtask-remove-btn').addEventListener('click', () => row.remove());

  /* チェックボックスは即時保存（保存ボタン押し忘れで✓が消える事故を防止） */
  row.querySelector('.subtask-check').addEventListener('change', e => {
    const taskId = document.getElementById('taskId').value;
    if (!taskId) return; // 新規作成中はフォーム送信まで保留
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const sub = (task.subtasks || []).find(s => s.id === subtask.id);
    if (!sub) return;
    sub.done = e.target.checked;
    saveCloud();
    render(); // 背後のカードの進捗バーを更新（モーダルはそのまま残る）
  });

  list.appendChild(row);
}

function collectSubtasks() {
  const rows = document.querySelectorAll('#subtaskList .subtask-row');
  const result = [];
  rows.forEach(row => {
    const titleInput = row.querySelector('.subtask-title-input');
    const checkInput = row.querySelector('.subtask-check');
    const title = titleInput.value.trim();
    if (!title) return;
    result.push({
      id: row.dataset.id || uid(),
      title,
      done: checkInput.checked,
    });
  });
  return result;
}

/* ===== Modal focus return (#354) =====
 * 閉じたら開いたボタンへフォーカスを戻す。再描画でボタンが差し替わっていたら同じ操作のボタンを探す */
let modalReturnFocus = null;
function rememberFocus() {
  const el = document.activeElement;
  modalReturnFocus = el && el !== document.body
    ? { el, selector: el.dataset?.action && el.dataset?.id ? `[data-action="${CSS.escape(el.dataset.action)}"][data-id="${CSS.escape(el.dataset.id)}"]` : null }
    : null;
}
function restoreFocus() {
  const r = modalReturnFocus;
  modalReturnFocus = null;
  if (!r) return;
  // 対象のタスクが絞り込みから外れた・削除された等で見つからなければ、クイック追加欄へ（body に落とさない）
  const target = (r.el.isConnected ? r.el : (r.selector ? document.querySelector(r.selector) : null))
    || document.getElementById('quickAddInput');
  target?.focus();
}

/* ===== Modal: Task ===== */
function openTaskModal(task = null) {
  const modal    = document.getElementById('taskModal');
  const title    = document.getElementById('taskModalTitle');
  const idInput  = document.getElementById('taskId');

  populateCategorySelect();

  document.getElementById('subtaskList').innerHTML = '';

  if (task) {
    title.textContent                                = 'タスク編集';
    idInput.value                                    = task.id;
    document.getElementById('taskTitle').value       = task.title;
    document.getElementById('taskDescription').value = task.description || '';
    document.getElementById('taskDeadline').value    = task.deadline || '';
    document.getElementById('taskPriority').value    = task.priority;
    document.getElementById('taskCategory').value    = task.categoryId || '';
    document.getElementById('taskStatus').value      = task.status;
    document.getElementById('taskTags').value        = (task.tags || []).join(', ');
    document.getElementById('taskRecurrence').value  = (task.recurrence && task.recurrence.type) || '';
    (task.subtasks || []).forEach(st => appendSubtaskRow(st));
  } else {
    title.textContent = 'タスク追加';
    document.getElementById('taskForm').reset();
    idInput.value = '';
    document.getElementById('taskPriority').value   = 'medium';
    document.getElementById('taskStatus').value     = 'todo';
    document.getElementById('taskTags').value       = '';
    document.getElementById('taskRecurrence').value = '';
    document.getElementById('taskCategory').value = state.filters.categoryId || '';
    if (state.filters.preset === 'today') document.getElementById('taskDeadline').value = todayStr();
  }

  rememberFocus();
  modal.classList.remove('hidden');
  document.getElementById('taskTitle').focus();
}

function closeTaskModal() {
  document.getElementById('taskModal').classList.add('hidden');
  restoreFocus();
}

/* ===== Modal: Category ===== */
function openCategoryModal() {
  document.getElementById('categoryName').value  = '';
  document.getElementById('categoryColor').value = '#CC0033';
  document.getElementById('categoryColorHex').textContent = '#CC0033';
  rememberFocus();
  document.getElementById('categoryModal').classList.remove('hidden');
  document.getElementById('categoryName').focus();
}

function closeCategoryModal() {
  document.getElementById('categoryModal').classList.add('hidden');
  restoreFocus();
}

/* ===== Modal: Shortcuts Help ===== */
function openShortcutsModal() {
  rememberFocus();
  document.getElementById('shortcutsModal').classList.remove('hidden');
  document.getElementById('closeShortcutsModal').focus();
}

function closeShortcutsModal() {
  document.getElementById('shortcutsModal').classList.add('hidden');
  restoreFocus();
}

/* ===== Inline subtask edit / add (card) =====
 * フォーカス維持のため、編集中・追加中は render() を呼ばず DOM を直接差し替える。
 * 確定時のみ state を更新 → saveCloud() → render() で再描画する。 */
function startEditSubtask(span) {
  const { id: taskId, sid } = span.dataset;
  const task = state.tasks.find(t => t.id === taskId);
  const sub  = task?.subtasks?.find(s => s.id === sid);
  if (!sub) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'subtask-inline-edit';
  input.value = sub.title;
  input.setAttribute('aria-label', 'サブタスクのタイトルを編集');
  span.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    if (next && next !== sub.title) {
      sub.title = next;
      saveCloud();
    }
    render(); // 元の span に戻る（または新タイトルで再描画）
  };
  const cancel = () => {
    if (done) return;
    done = true;
    render();
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}

function startAddSubtask(btn) {
  const { id: taskId } = btn.dataset;
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  if (!task.subtasks) task.subtasks = [];

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'subtask-inline-edit subtask-inline-add-input';
  input.placeholder = 'サブタスクを入力 → Enter';
  input.setAttribute('aria-label', '新規サブタスクのタイトル');
  btn.replaceWith(input);
  input.focus();

  let done = false;
  const finalize = () => {
    // commit/cancel 後、サブタスクが 0 件のままなら展開も解除（空のまま開きっぱなしを防ぐ）
    if (!task.subtasks || task.subtasks.length === 0) {
      uiState.expanded.delete(taskId);
      saveExpanded();
    }
    render();
  };
  const commit = () => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    if (title) {
      task.subtasks.push({ id: uid(), title, done: false });
      saveCloud();
    }
    finalize();
  };
  const cancel = () => {
    if (done) return;
    done = true;
    finalize();
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}

/* ===== Card action menu（ドラッグ非依存の明示操作 #111） =====
 * 常時表示の「⋮」ボタンから 編集 / 上へ・下へ / ステータス移動 / 削除 を
 * タップ・キーボードで実行できる正規ルート。スワイプ・D&D はショートカット扱い。 */
const STATUS_MOVE = [
  { value: 'todo',       label: '未着手へ移動' },
  { value: 'inprogress', label: '進行中へ移動' },
  { value: 'done',       label: '完了にする' },
];

/* 表示順で1つ上/下へ入れ替え（手動ソートに切替）。D&D と同じく表示中タスクの order を再採番 */
function moveTask(id, dir) {
  const visible = getFilteredTasks();
  const idx = visible.findIndex(t => t.id === id);
  const swap = idx + dir;
  if (idx < 0 || swap < 0 || swap >= visible.length) return;
  [visible[idx], visible[swap]] = [visible[swap], visible[idx]];
  visible.forEach((t, i) => {
    const real = state.tasks.find(x => x.id === t.id);
    if (real) real.order = i;
  });
  syncManualSort();
  saveCloud();
  render();
}

/* ステータス変更（完了化時は toggleDone と同じく繰り返しを自動生成） */
function moveToStatus(id, status) {
  const task = state.tasks.find(t => t.id === id);
  if (!task || task.status === status) return;
  const prevStatus = task.status;
  task.status = status;
  spawnNextIfNeeded(task, prevStatus);
  saveCloud();
  render();
}

let cardMenuState = { open: false, triggerBtn: null };

function closeCardMenu() {
  const menu = document.getElementById('cardMenu');
  if (cardMenuState.triggerBtn && document.contains(cardMenuState.triggerBtn)) {
    cardMenuState.triggerBtn.setAttribute('aria-expanded', 'false');
  }
  cardMenuState = { open: false, triggerBtn: null };
  if (!menu) return;
  menu.classList.add('hidden');
  menu.setAttribute('aria-hidden', 'true');
  menu.innerHTML = '';
  menu._items = null;
}

function openCardMenu(triggerBtn, id) {
  const task = state.tasks.find(t => t.id === id);
  const menu = document.getElementById('cardMenu');
  if (!task || !menu) return;
  // 同じトリガーで既に開いていれば作り直さない（再クリック時のちらつき・DOM差し替え防止）
  if (cardMenuState.open && cardMenuState.triggerBtn === triggerBtn) return;

  const visible = getFilteredTasks();
  const idx = visible.findIndex(t => t.id === id);
  const items = [
    { label: '✏️ 編集',  fn: () => openTaskModal(task) },
    { label: '⬆️ 上へ',  fn: () => moveTask(id, -1), disabled: idx <= 0 },
    { label: '⬇️ 下へ',  fn: () => moveTask(id, +1), disabled: idx < 0 || idx >= visible.length - 1 },
    ...STATUS_MOVE.filter(s => s.value !== task.status)
      .map(s => ({ label: s.label, fn: () => moveToStatus(id, s.value) })),
    { label: '🗑️ 削除', danger: true, fn: () => deleteTask(id) },
  ];
  menu._items = items;
  menu.innerHTML = items.map((it, i) =>
    `<button type="button" role="menuitem" class="card-menu-item${it.danger ? ' danger' : ''}" data-i="${i}"${it.disabled ? ' disabled' : ''}>${it.label}</button>`
  ).join('');

  menu.classList.remove('hidden');
  menu.setAttribute('aria-hidden', 'false');
  const r = triggerBtn.getBoundingClientRect();
  let left = r.right - menu.offsetWidth;
  let top  = r.bottom + 4;
  if (top + menu.offsetHeight > window.innerHeight) top = r.top - menu.offsetHeight - 4;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top  = `${Math.max(8, top)}px`;

  triggerBtn.setAttribute('aria-expanded', 'true');
  cardMenuState = { open: true, triggerBtn };
  menu.querySelector('.card-menu-item:not([disabled])')?.focus();
}

function activateCardMenuItem(i) {
  const menu = document.getElementById('cardMenu');
  const it = menu?._items?.[i];
  const trigger = cardMenuState.triggerBtn;
  closeCardMenu();
  trigger?.focus(); // メニューから開くモーダルが閉じたとき ⋮ へ戻れるように
  if (it && !it.disabled) it.fn();
}

function handleCardMenuKeydown(e) {
  if (!cardMenuState.open) return;
  const menu = document.getElementById('cardMenu');
  if (!menu) return;
  const els = [...menu.querySelectorAll('.card-menu-item:not([disabled])')];
  const pos = els.indexOf(document.activeElement);
  if (e.key === 'Escape') {
    e.preventDefault();
    const t = cardMenuState.triggerBtn;
    closeCardMenu();
    t?.focus();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    els[(pos + 1) % els.length]?.focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    els[(pos - 1 + els.length) % els.length]?.focus();
  }
}

/* 操作メニュー(⋮)の初回ヒント。チュートリアルの壁は作らず、トースト1回だけ。 */
function maybeShowActionHint() {
  try {
    if (localStorage.getItem(HINT_KEY)) return;
    if (!state.tasks.length) return; // タスクが無いと意味がないので出さない
    localStorage.setItem(HINT_KEY, '1');
    showToast('カード右の ⋮ から 移動・完了・削除 ができます', undefined, 7000);
  } catch {}
}

/* ===== Event Delegation ===== */
function handleGlobalClick(e) {
  // 操作メニュー：項目クリックで実行
  const menuItem = e.target.closest('.card-menu-item');
  if (menuItem) { activateCardMenuItem(Number(menuItem.dataset.i)); return; }
  // 開いている時、メニュー外・トリガー外クリックで閉じる
  if (cardMenuState.open &&
      !e.target.closest('#cardMenu') &&
      !e.target.closest('[data-action="card-menu"]')) {
    closeCardMenu();
  }
  const el     = e.target.closest('[data-action]');
  const catBtn = e.target.closest('[data-category-id]');

  // Category filter chip
  if (catBtn && catBtn.closest('#categoryFilter')) {
    state.filters.categoryId = catBtn.dataset.categoryId;
    renderSidebar();
    render();
    closeSidebar(); // モバイルのドロワーを閉じる
    return;
  }

  if (!el) return;
  const { action, id } = el.dataset;

  if (action === 'card-menu')   { openCardMenu(el, id); return; }
  if (action === 'toggle')      { toggleDone(id); return; }
  if (action === 'edit')        { openTaskModal(state.tasks.find(t => t.id === id)); return; }
  if (action === 'delete')      { deleteTask(id); return; }
  if (action === 'delete-cat')  { deleteCategory(id); return; }
  if (action === 'sync-retry')  { saveCloud(); return; }
  if (action === 'skip')        { skipRecurrence(id); return; }
  if (action === 'toggle-subtasks') {
    if (uiState.expanded.has(id)) uiState.expanded.delete(id);
    else                          uiState.expanded.add(id);
    saveExpanded();
    render();
    return;
  }
  if (action === 'edit-subtask') { startEditSubtask(el); return; }
  if (action === 'add-subtask')  { startAddSubtask(el);  return; }
  if (action === 'add-subtask-empty') {
    // 0件タスクの導線：展開 → 再描画後にインライン入力を自動オープン
    uiState.expanded.add(id);
    saveExpanded();
    render();
    const btn = document.querySelector(`.subtask-inline-add[data-action="add-subtask"][data-id="${id}"]`);
    if (btn) startAddSubtask(btn);
    return;
  }
}

/* Enter / Space で role="button" 要素を活性化（subtask 編集スパン等） */
function handleDelegatedActivation(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('[role="button"][data-action]');
  if (!el) return;
  e.preventDefault();
  el.click();
}

function handleGlobalChange(e) {
  const statusEl = e.target.closest('[data-action="status"]');
  if (statusEl) { updateTask(statusEl.dataset.id, { status: statusEl.value }); return; }

  const subEl = e.target.closest('[data-action="toggle-subtask"]');
  if (subEl) {
    const { id, sid } = subEl.dataset;
    const task = state.tasks.find(t => t.id === id);
    const st = task?.subtasks?.find(s => s.id === sid);
    if (!st) return;
    st.done = subEl.checked;
    saveCloud();
    render(); // 進捗バー更新。uiState.expanded は維持されるので開いたまま。
  }
}

/* ===== Task form submit ===== */
function handleTaskFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('taskId').value;
  const tags = document.getElementById('taskTags').value
    .split(',').map(s => s.trim()).filter(Boolean);
  const recurrenceType = document.getElementById('taskRecurrence').value;
  const deadline = document.getElementById('taskDeadline').value;
  // 種別も期限も変えていなければ、毎月の anchorDay 等を保持する（期限を手で変えたら基準日は付け直し）
  const prev = id ? state.tasks.find(t => t.id === id) : null;
  const keepRecurrence = prev?.recurrence?.type === recurrenceType && prev.deadline === deadline;
  const data = {
    title:       document.getElementById('taskTitle').value.trim(),
    description: document.getElementById('taskDescription').value.trim(),
    deadline,
    priority:    document.getElementById('taskPriority').value,
    categoryId:  document.getElementById('taskCategory').value,
    status:      document.getElementById('taskStatus').value,
    tags,
    subtasks:    collectSubtasks(),
    recurrence:  recurrenceType ? (keepRecurrence ? { ...prev.recurrence } : { type: recurrenceType }) : null,
  };
  if (!data.title) return;

  if (id) updateTask(id, data);
  else    addTask(data);

  closeTaskModal();
}

/* ===== Sidebar drawer (mobile) ===== */
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('visible');
  const btn = document.getElementById('hamburgerBtn');
  btn.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('visible');
  const btn = document.getElementById('hamburgerBtn');
  btn.classList.remove('open');
  btn.setAttribute('aria-expanded', 'false');
}

function toggleSidebar() {
  const isOpen = document.getElementById('sidebar').classList.contains('open');
  isOpen ? closeSidebar() : openSidebar();
}

/* ===== View toggle helper ===== */
function syncViewToggleUI(view) {
  const isList = view === 'list';
  ['listViewBtn', 'listViewBtnMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active', isList);
    el.setAttribute('aria-pressed', isList ? 'true' : 'false');
  });
  ['kanbanViewBtn', 'kanbanViewBtnMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active', !isList);
    el.setAttribute('aria-pressed', !isList ? 'true' : 'false');
  });
}

/* preset-chips の active 表示を state に同期（起動時の復元用） */
function syncPresetChipUI(preset) {
  document.querySelectorAll('.preset-chip').forEach(c => {
    const isActive = (c.dataset.preset || '') === (preset || '');
    c.classList.toggle('active', isActive);
    c.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  syncQuickAddPlaceholder();
}

/* 絞り込みを全解除してUIへ反映（並べ替えと「完了タスクを隠す」は表示設定として維持） */
function clearFilters() {
  Object.assign(state.filters, { categoryId: '', priority: '', status: '', search: '', preset: '' });
  document.getElementById('statusFilter').value = '';
  document.getElementById('priorityFilter').value = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('searchClear').style.display = 'none';
  syncPresetChipUI('');
  renderSidebar();
  render();
}

/* 「今日」ビューのクイック追加は期限=今日になることを入力欄で示す (#352) */
function syncQuickAddPlaceholder() {
  const input = document.getElementById('quickAddInput');
  if (!input) return;
  const today = state.filters.preset === 'today';
  input.placeholder = today
    ? '今日やることを入力して Enter（期限は今日）'
    : 'タイトルを入力して Enter で追加（N キーでフォーカス）';
  // 読み上げでも期限が今日になることを伝える（aria-label が placeholder より優先されるため）
  input.setAttribute('aria-label', today
    ? 'クイック追加：今日やることを入力して Enter（期限は今日）'
    : 'クイック追加：タイトルを入力して Enter で追加');
}

function switchView(view) {
  state.currentView = view;
  try { localStorage.setItem(VIEW_KEY, view); } catch {}
  track('view_changed', { view });
  const isList = view === 'list';
  syncViewToggleUI(view);
  const showEl = document.getElementById(isList ? 'listView' : 'kanbanView');
  const hideEl = document.getElementById(isList ? 'kanbanView' : 'listView');
  hideEl.classList.add('hidden');
  showEl.classList.remove('hidden');
  showEl.classList.add('view-entering');
  showEl.addEventListener('animationend', () => showEl.classList.remove('view-entering'), { once: true });
  render();
}

/* ===== Ripple effect ===== */
function addRipple(e) {
  const btn = e.currentTarget;
  const circle = document.createElement('span');
  const diameter = Math.max(btn.clientWidth, btn.clientHeight);
  const rect = btn.getBoundingClientRect();
  circle.className = 'ripple-wave';
  circle.style.cssText = `width:${diameter}px;height:${diameter}px;left:${e.clientX - rect.left - diameter / 2}px;top:${e.clientY - rect.top - diameter / 2}px`;
  btn.querySelector('.ripple-wave')?.remove();
  btn.appendChild(circle);
  circle.addEventListener('animationend', () => circle.remove(), { once: true });
}


/* ===== Swipe Gesture (タッチイベントをカードに直接付与) ===== */
function attachSwipeListeners(card, wrapper, id) {
  let startX = 0, startY = 0, currentX = 0;
  let active = false, canceled = false;

  function snapBack() {
    card.classList.remove('is-swiping');
    card.classList.add('snap-back');
    card.style.setProperty('transform', 'translateX(0)', 'important');
    card.addEventListener('transitionend', () => {
      card.classList.remove('snap-back');
      card.style.removeProperty('transform');
    }, { once: true });
  }

  function doDelete() {
    const idx = state.tasks.findIndex(t => t.id === id);
    if (idx < 0) return;
    const removed = state.tasks[idx];

    card.classList.remove('is-swiping');
    card.classList.add('snap-back');
    card.style.setProperty('transform', 'translateX(-100vw)', 'important');
    card.style.opacity = '0';
    // transitionend は信頼性が低いため setTimeout で確実に削除
    setTimeout(() => {
      wrapper.remove();
      state.tasks = state.tasks.filter(t => t.id !== id);
      saveCloud();
      render();
      showToast(`「${removed.title}」を削除しました`, () => {
        if (state.tasks.some(t => t.id === removed.id)) return;
        state.tasks.splice(Math.min(idx, state.tasks.length), 0, removed);
        saveCloud();
        render();
      });
    }, 350);
  }

  function reset() {
    wrapper.classList.remove('swiping', 'swiping-left', 'swiping-right',
                              'trigger-delete', 'trigger-complete');
    card.classList.remove('is-swiping');
    active = false;
    canceled = false;
  }

  card.addEventListener('touchstart', (e) => {
    if (card.classList.contains('removing')) return;
    // インライン操作領域（サブタスク展開・トグル・アクションボタン）はスワイプ対象外
    if (e.target.closest('.task-subtasks-inline, .subtask-toggle, .task-actions, .card-menu-btn')) {
      active = false;
      canceled = true;
      return;
    }
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    currentX = t.clientX;
    active = true;
    canceled = false;
  }, { passive: false }); // falseでブラウザにJS優先を伝える

  card.addEventListener('touchmove', (e) => {
    if (!active || canceled) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    // 方向判定（8px動くまで待つ）
    if (!card.classList.contains('is-swiping')) {
      if (Math.abs(dx) + Math.abs(dy) < 8) return;
      if (Math.abs(dy) >= Math.abs(dx)) { canceled = true; return; } // 縦 → スクロール優先
      card.classList.add('is-swiping');
    }

    // 横スワイプ確定 → ブラウザのスクロールを止める（passive:falseが必須）
    e.preventDefault();
    currentX = t.clientX;
    card.style.setProperty('transform', `translateX(${dx}px)`, 'important');
    wrapper.classList.toggle('swiping',          Math.abs(dx) > 10);
    wrapper.classList.toggle('swiping-left',     dx < -10);
    wrapper.classList.toggle('swiping-right',    dx > 10);
    wrapper.classList.toggle('trigger-delete',   dx < -SWIPE_AUTO_TRIGGER);
    wrapper.classList.toggle('trigger-complete', dx > SWIPE_AUTO_TRIGGER);
  }, { passive: false }); // falseにしてpreventDefault()を有効化

  card.addEventListener('touchend', () => {
    if (!active) return;
    const wasSwiping = card.classList.contains('is-swiping');
    const dx = currentX - startX;
    reset();
    if (!wasSwiping) return;

    if (dx < -SWIPE_AUTO_TRIGGER) {
      doDelete();
    } else if (dx > SWIPE_AUTO_TRIGGER) {
      snapBack();
      setTimeout(() => toggleDone(id), 280);
    } else {
      snapBack();
    }
  }, { passive: true });

  card.addEventListener('touchcancel', () => {
    if (!active) return;
    snapBack();
    reset();
  }, { passive: true });
}

function initSwipeGestures() { /* attachSwipeListeners()でカード生成時に付与 */ }

/* ===== Drag & Drop (desktop only) ===== */
const isDndDesktop = () => window.matchMedia('(hover: hover)').matches;
const dragState = { id: null };

function attachCardDragHandlers(card) {
  if (!isDndDesktop()) return;
  card.draggable = true;
  card.addEventListener('dragstart', e => {
    // インライン操作領域（サブタスク展開・トグル・アクションボタン・編集 input）
    // から発火したドラッグはキャンセル。テキスト選択やクリックを優先。
    if (e.target.closest('.task-subtasks-inline, .subtask-toggle, .task-actions, .kanban-status-select, .card-menu-btn')) {
      e.preventDefault();
      return;
    }
    dragState.id = card.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.id);
    card.classList.add('dragging');
    card.closest('.swipe-wrapper')?.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    card.closest('.swipe-wrapper')?.classList.remove('dragging');
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    dragState.id = null;
  });
}

function getDragAfterElement(container, y, selector) {
  const items = [...container.querySelectorAll(`${selector}:not(.dragging)`)];
  return items.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function syncManualSort() {
  if (state.filters.sort !== 'manual') {
    state.filters.sort = 'manual';
    const sel = document.getElementById('sortOrder');
    if (sel) sel.value = 'manual';
  }
}

function handleListDragOver(e) {
  if (!dragState.id) return;
  e.preventDefault();
  const container = document.getElementById('taskList');
  container.classList.add('drop-target');

  const draggingWrapper = container.querySelector('.swipe-wrapper.dragging');
  if (!draggingWrapper) return;
  const afterWrapper = getDragAfterElement(container, e.clientY, '.swipe-wrapper');
  if (!afterWrapper) container.appendChild(draggingWrapper);
  else if (afterWrapper !== draggingWrapper) container.insertBefore(draggingWrapper, afterWrapper);
}

function handleListDrop(e) {
  if (!dragState.id) return;
  e.preventDefault();
  const container = document.getElementById('taskList');
  container.classList.remove('drop-target');

  const newOrder = [...container.querySelectorAll('.swipe-wrapper .task-card[data-id]')]
                     .map(c => c.dataset.id);
  newOrder.forEach((tid, idx) => {
    const t = state.tasks.find(tt => tt.id === tid);
    if (t) t.order = idx;
  });

  syncManualSort();
  saveCloud();
  render();
}

function handleKanbanDragOver(e) {
  if (!dragState.id) return;
  e.preventDefault();
  const container = e.currentTarget;
  container.classList.add('drop-target');

  const draggedCard = document.querySelector(`.kanban-card[data-id="${dragState.id}"]`);
  if (!draggedCard) return;
  const afterEl = getDragAfterElement(container, e.clientY, '.kanban-card');
  if (!afterEl) container.appendChild(draggedCard);
  else if (afterEl !== draggedCard) container.insertBefore(draggedCard, afterEl);
}

function handleKanbanDragLeave(e) {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('drop-target');
}

function handleKanbanDrop(e, status) {
  if (!dragState.id) return;
  e.preventDefault();
  const container = document.getElementById(`${status}Cards`);
  container.classList.remove('drop-target');

  const task = state.tasks.find(t => t.id === dragState.id);
  if (!task) return;

  const newIds = [...container.querySelectorAll('.kanban-card[data-id]')].map(c => c.dataset.id);
  newIds.forEach((tid, idx) => {
    const t = state.tasks.find(tt => tt.id === tid);
    if (t) t.order = idx;
  });

  const prevStatus = task.status;
  task.status = status;
  spawnNextIfNeeded(task, prevStatus);

  syncManualSort();
  saveCloud();
  render();
}

function initDragDropZones() {
  if (!isDndDesktop()) return;
  const list = document.getElementById('taskList');
  list.addEventListener('dragover', handleListDragOver);
  list.addEventListener('dragleave', e => { if (e.target === list) list.classList.remove('drop-target'); });
  list.addEventListener('drop', handleListDrop);

  ['todo', 'inprogress', 'done'].forEach(status => {
    const col = document.getElementById(`${status}Cards`);
    col.addEventListener('dragover', handleKanbanDragOver);
    col.addEventListener('dragleave', handleKanbanDragLeave);
    col.addEventListener('drop', e => handleKanbanDrop(e, status));
  });
}

function reconcileWithCloud(d) {
  if (!d) {
    // クラウドにドキュメントが無い＝初回（loadStorage の移行分岐と同じ扱い）。ローカルをそのまま上げる
    cloudLoaded = true;
    fallbackBaseline = null;
    if (state.tasks.length || state.categories.length) saveCloud();
    else { lastSaveFailed = false; setSyncState('idle'); }
    return;
  }
  const base  = fallbackBaseline || { tasks: [], categories: [] };
  const tasks = mergeFallbackChanges(base.tasks, state.tasks, (d.tasks || []).map(normalizeTask));
  const cats  = mergeFallbackChanges(base.categories, state.categories, d.categories || []);
  state.tasks      = tasks.items;
  state.categories = cats.items;
  cloudLoaded      = true;
  fallbackBaseline = null;
  if (tasks.hasLocalChanges || cats.hasLocalChanges) saveCloud();
  else { lastSaveFailed = false; saveLocalMirror(); saveSynced(snapshotData()); setSyncState('idle'); }
  renderSidebar();
  render();
}

/* ===== Init ===== */
async function init() {
  await loadStorage();
  applyTheme(state.theme);
  applyFontSize(localStorage.getItem(FONTSIZE_KEY) || 'standard');
  // ビュー形式（List/Kanban）のみ前回値を復元。preset は state 既定の 'today' 固定
  const savedView = localStorage.getItem(VIEW_KEY);
  state.currentView = savedView === 'kanban' ? 'kanban' : 'list';
  syncViewToggleUI(state.currentView);
  syncPresetChipUI(state.filters.preset);
  renderSidebar();
  render();
  maybeShowActionHint();
  if (!cloudLoaded) setSyncState('local');

  /* リアルタイム同期: 他デバイスの変更を自動反映 */
  // includeMetadataChanges: キャッシュ→サーバーで中身が同じ（fromCache だけ変わる）場合も通知を受け、
  // 未同期モードから確実に抜けるため
  onSnapshot(DATA_DOC, { includeMetadataChanges: true }, (snap) => {
    if (!cloudLoaded) {
      // 未同期モードでは、サーバー由来のスナップショットが届いた時点でクラウドを正とし、
      // 未同期の間のローカル変更だけを載せ直してから書き戻す（キャッシュ由来は判定材料にしない）
      if (snap.metadata.fromCache) return;
      reconcileWithCloud(snap.exists() ? snap.data() : null);
      return;
    }
    if (!snap.exists()) return;
    const d = snap.data();
    const next = snapshotData((d.tasks || []).map(normalizeTask), d.categories || []);
    if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) saveSynced(next);
    // 自分の書込み確認（hasPendingWrites だけ変わる通知）で再描画すると、開いたメニューや編集中の入力が閉じるため
    if (JSON.stringify(next) === JSON.stringify(snapshotData())) return;
    state.tasks      = next.tasks;
    state.categories = next.categories;
    saveLocalMirror();
    renderSidebar();
    render();
  });

  /* Theme toggle */
  document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

  /* Search */
  document.getElementById('searchInput').addEventListener('input', e => {
    state.filters.search = e.target.value;
    document.getElementById('searchClear').style.display = e.target.value ? 'flex' : 'none';
    render();
  });
  document.getElementById('searchClear').addEventListener('click', () => {
    state.filters.search = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClear').style.display = 'none';
    render();
  });

  /* Hamburger */
  document.getElementById('hamburgerBtn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

  /* View toggle（デスクトップ・モバイル共通） */
  document.getElementById('listViewBtn').addEventListener('click', () => switchView('list'));
  document.getElementById('kanbanViewBtn').addEventListener('click', () => switchView('kanban'));
  document.getElementById('listViewBtnMobile').addEventListener('click', () => switchView('list'));
  document.getElementById('kanbanViewBtnMobile').addEventListener('click', () => switchView('kanban'));

  /* Task modal open */
  document.getElementById('addTaskBtn').addEventListener('click', () => openTaskModal());
  document.getElementById('fabAddTask').addEventListener('click', () => openTaskModal());

  /* Quick add (inline, title-only) */
  const quickAddInput = document.getElementById('quickAddInput');
  const quickAddDetailBtn = document.getElementById('quickAddDetailBtn');
  const quickAddMeta = { priority: 'medium', deadlinePreset: '' /* '' | 'today' | 'tomorrow' */ };

  function quickAddResolveDeadline() {
    if (quickAddMeta.deadlinePreset === 'today')    return todayStr();
    if (quickAddMeta.deadlinePreset === 'tomorrow') return addDays(todayStr(), 1);
    // 期限チップ未指定でも「今日」ビューでは今日にする（今日ビュー＝今日やることを足す場所 #352）
    if (state.filters.preset === 'today') return todayStr();
    return '';
  }
  function quickAddSubmit() {
    const title = quickAddInput.value.trim();
    if (!title) return;
    addTask({
      title,
      description: '',
      deadline: quickAddResolveDeadline(),
      priority: quickAddMeta.priority,
      categoryId: state.filters.categoryId || '',
      status: 'todo',
      tags: [],
      subtasks: [],
      recurrence: null,
    });
    quickAddInput.value = '';
    quickAddInput.focus();
    // チップは連投時のためスティッキー（リロードまで維持）
  }
  function quickAddOpenModal() {
    const title = quickAddInput.value.trim();
    openTaskModal();
    if (title) {
      document.getElementById('taskTitle').value = title;
    }
    if (state.filters.categoryId) {
      document.getElementById('taskCategory').value = state.filters.categoryId;
    }
    document.getElementById('taskPriority').value = quickAddMeta.priority;
    const resolved = quickAddResolveDeadline();
    if (resolved) document.getElementById('taskDeadline').value = resolved;
    quickAddInput.value = '';
  }
  quickAddInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (e.shiftKey) quickAddOpenModal();
    else            quickAddSubmit();
  });
  quickAddDetailBtn.addEventListener('click', quickAddOpenModal);

  /* Quick add meta chips（[高] [今日] [明日]） */
  document.querySelectorAll('.quick-add-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const meta = chip.dataset.meta;
      if (meta === 'priority-high') {
        quickAddMeta.priority = quickAddMeta.priority === 'high' ? 'medium' : 'high';
      } else if (meta === 'deadline-today') {
        quickAddMeta.deadlinePreset = quickAddMeta.deadlinePreset === 'today' ? '' : 'today';
      } else if (meta === 'deadline-tomorrow') {
        quickAddMeta.deadlinePreset = quickAddMeta.deadlinePreset === 'tomorrow' ? '' : 'tomorrow';
      }
      // UIへ反映
      document.querySelectorAll('.quick-add-chip').forEach(c => {
        let active = false;
        if (c.dataset.meta === 'priority-high')     active = quickAddMeta.priority === 'high';
        if (c.dataset.meta === 'deadline-today')    active = quickAddMeta.deadlinePreset === 'today';
        if (c.dataset.meta === 'deadline-tomorrow') active = quickAddMeta.deadlinePreset === 'tomorrow';
        c.classList.toggle('active', active);
        c.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      quickAddInput.focus();
    });
  });

  /* Task modal close */
  document.getElementById('closeTaskModal').addEventListener('click', closeTaskModal);
  document.getElementById('cancelTaskModal').addEventListener('click', closeTaskModal);
  document.getElementById('taskModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTaskModal();
  });

  /* Task form */
  document.getElementById('taskForm').addEventListener('submit', handleTaskFormSubmit);

  /* Subtask add button */
  document.getElementById('addSubtaskBtn').addEventListener('click', () => {
    appendSubtaskRow();
    const list = document.getElementById('subtaskList');
    list.lastElementChild?.querySelector('.subtask-title-input')?.focus();
  });

  /* Shortcuts help modal */
  document.getElementById('shortcutsHelpBtn').addEventListener('click', openShortcutsModal);
  document.getElementById('closeShortcutsModal').addEventListener('click', closeShortcutsModal);
  document.getElementById('shortcutsModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeShortcutsModal();
  });

  /* Category modal open */
  document.getElementById('addCategoryBtn').addEventListener('click', openCategoryModal);

  /* Category modal close */
  document.getElementById('closeCategoryModal').addEventListener('click', closeCategoryModal);
  document.getElementById('cancelCategoryModal').addEventListener('click', closeCategoryModal);
  document.getElementById('categoryModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeCategoryModal();
  });

  /* Category save */
  document.getElementById('saveCategoryBtn').addEventListener('click', () => {
    const name  = document.getElementById('categoryName').value.trim();
    const color = document.getElementById('categoryColor').value;
    if (!name) { document.getElementById('categoryName').focus(); return; }
    addCategory(name, color);
    closeCategoryModal();
  });

  /* Category color preview */
  document.getElementById('categoryColor').addEventListener('input', e => {
    document.getElementById('categoryColorHex').textContent = e.target.value;
  });

  /* Current project badge: clear filter */
  document.getElementById('currentProjectBadge').addEventListener('click', () => {
    state.filters.categoryId = '';
    renderSidebar();
    render();
  });

  /* Filters */
  document.getElementById('statusFilter').addEventListener('change', e => {
    state.filters.status = e.target.value;
    render();
  });
  document.getElementById('priorityFilter').addEventListener('change', e => {
    state.filters.priority = e.target.value;
    render();
  });
  document.getElementById('sortOrder').addEventListener('change', e => {
    state.filters.sort = e.target.value;
    render();
  });
  document.getElementById('hideCompletedFilter').addEventListener('change', e => {
    state.filters.hideCompleted = e.target.checked;
    render();
  });

  /* Font size buttons (sidebar) */
  document.querySelectorAll('.fontsize-btn').forEach(btn => {
    btn.addEventListener('click', () => applyFontSize(btn.dataset.fontsize));
  });

  /* Preset chips（今日 / 今週 / 期限切れ） */
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.filters.preset = chip.dataset.preset || '';
      syncPresetChipUI(state.filters.preset);
      render();
    });
  });

  /* Ripple on primary buttons */
  document.querySelectorAll('.btn-primary, .btn-secondary').forEach(btn => {
    btn.addEventListener('click', addRipple);
  });

  /* Header elevation on scroll */
  const header = document.querySelector('.header');
  window.addEventListener('scroll', () => {
    header.classList.toggle('elevated', window.scrollY > 4);
    if (cardMenuState.open) closeCardMenu(); // スクロールで位置がずれるため閉じる
  }, { passive: true });

  /* Global delegation */
  document.addEventListener('click', handleGlobalClick);
  document.addEventListener('change', handleGlobalChange);
  document.addEventListener('keydown', handleDelegatedActivation);
  document.addEventListener('keydown', handleCardMenuKeydown);

  /* Swipe gestures (mobile list view) */
  initSwipeGestures();

  /* D&D drop zones (desktop only) */
  initDragDropZones();

  /* Online / offline detection */
  window.addEventListener('offline', () => setSyncState('offline'));
  // 復帰時に自動で setDoc しない（クラウド最新を読む前の全件置換で他端末の変更を消すため #349）。
  // 未同期ならサーバーから直接読んで差分マージする（スナップショットが来ない経路の保険）
  window.addEventListener('online', () => {
    // 保存失敗の表示（再試行導線）は回線の出入りで消さない（offline 表示を挟んでも復帰時に戻す）
    if (cloudLoaded) { setSyncState(lastSaveFailed ? 'error' : 'idle'); return; }
    setSyncState('local');
    getDocFromServer(DATA_DOC)
      .then(s => { if (!cloudLoaded) reconcileWithCloud(s.exists() ? s.data() : null); })
      .catch(() => {});
  });
  if (navigator.onLine === false) setSyncState('offline');

  /* Keyboard shortcuts */
  document.addEventListener('keydown', handleKeyboardShortcut);
}

/* ===== Keyboard Shortcuts =====
   N : クイック追加バーにフォーカス
   / : 検索バーにフォーカス
   ? : キーボードショートカット一覧モーダルを表示
   Esc: 開いているモーダルを閉じる / フォーカス中の入力をぼかす
   Ctrl+Z / Cmd+Z : 直近のUndoを実行（入力中・モーダル中は無効）
*/
function handleKeyboardShortcut(e) {
  const target = e.target;
  const tag    = (target?.tagName || '').toUpperCase();
  const isTyping =
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
    target?.isContentEditable;

  // Ctrl+Z / Cmd+Z: 直近のUndo
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey &&
      (e.key === 'z' || e.key === 'Z')) {
    // 入力中はブラウザのネイティブUndo（テキスト編集）を優先
    if (isTyping) return;
    const taskModalOpen      = !document.getElementById('taskModal')?.classList.contains('hidden');
    const catModalOpen       = !document.getElementById('categoryModal')?.classList.contains('hidden');
    const shortcutsModalOpen = !document.getElementById('shortcutsModal')?.classList.contains('hidden');
    if (taskModalOpen || catModalOpen || shortcutsModalOpen) return;
    if (triggerLatestUndo()) {
      e.preventDefault();
      showToast('元に戻しました');
    }
    return;
  }

  // 他のCtrl/Cmd/Alt 付きはブラウザ標準操作を優先（Shift は ? 入力で使うため除外）
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // Esc は常に効かせる（モーダル閉じ / 入力からのフォーカス外し）
  if (e.key === 'Escape') {
    const taskModal      = document.getElementById('taskModal');
    const catModal       = document.getElementById('categoryModal');
    const shortcutsModal = document.getElementById('shortcutsModal');
    if (taskModal && !taskModal.classList.contains('hidden')) {
      closeTaskModal();
      e.preventDefault();
      return;
    }
    if (catModal && !catModal.classList.contains('hidden')) {
      closeCategoryModal();
      e.preventDefault();
      return;
    }
    if (shortcutsModal && !shortcutsModal.classList.contains('hidden')) {
      closeShortcutsModal();
      e.preventDefault();
      return;
    }
    if (isTyping && typeof target.blur === 'function') {
      target.blur();
      e.preventDefault();
    }
    return;
  }

  // 入力中・モーダル表示中は N / / / ? を無効化
  if (isTyping) return;
  const taskModalOpen      = !document.getElementById('taskModal')?.classList.contains('hidden');
  const catModalOpen       = !document.getElementById('categoryModal')?.classList.contains('hidden');
  const shortcutsModalOpen = !document.getElementById('shortcutsModal')?.classList.contains('hidden');
  if (taskModalOpen || catModalOpen || shortcutsModalOpen) return;

  if (e.key === 'n' || e.key === 'N') {
    const input = document.getElementById('quickAddInput');
    if (input) { input.focus(); input.select?.(); e.preventDefault(); }
    return;
  }
  if (e.key === '/') {
    const input = document.getElementById('searchInput');
    if (input) { input.focus(); input.select?.(); e.preventDefault(); }
    return;
  }
  if (e.key === '?') {
    openShortcutsModal();
    e.preventDefault();
  }
}

document.addEventListener('DOMContentLoaded', init);
