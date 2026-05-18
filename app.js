/* ===== Firebase ===== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBEN2Cd1CGzC3aN9hHS4m8o1MCnF6z5oBk",
  authDomain: "dtask-d08b6.firebaseapp.com",
  projectId: "dtask-d08b6",
  storageBucket: "dtask-d08b6.firebasestorage.app",
  messagingSenderId: "459534305297",
  appId: "1:459534305297:web:f30a96b68d3fc2dc3e49b0"
};

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
    preset: '', // '', 'today', 'week', 'overdue'
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

const SYNC_STATES = {
  idle:    { html: '' },
  syncing: { html: '<span class="sync-dot" aria-hidden="true"></span>同期中…' },
  saved:   { html: '✓ 保存済み' },
  error:   { html: '⚠ 保存失敗 <button class="sync-retry-btn" type="button" data-action="sync-retry">再試行</button>' },
  offline: { html: '📵 オフライン' },
};
let syncIdleTimer = null;

function setSyncState(stateName) {
  const el = document.getElementById('syncIndicator');
  if (!el) return;
  clearTimeout(syncIdleTimer);
  el.className = `sync-indicator sync-${stateName}`;
  el.innerHTML = SYNC_STATES[stateName].html;
  if (stateName === 'saved') {
    syncIdleTimer = setTimeout(() => setSyncState('idle'), 2000);
  }
}

async function saveCloud() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setSyncState('offline');
    return;
  }
  setSyncState('syncing');
  try {
    await setDoc(DATA_DOC, { tasks: state.tasks, categories: state.categories });
    setSyncState('saved');
  } catch (err) {
    console.error('saveCloud failed', err);
    setSyncState('error');
  }
}

async function loadStorage() {
  state.theme = localStorage.getItem(THEME_KEY) || 'light';

  const snap = await getDoc(DATA_DOC);
  if (snap.exists()) {
    const d = snap.data();
    state.tasks      = (d.tasks      || []).map(normalizeTask);
    state.categories = d.categories || [];
  } else {
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

function formatDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-');
  return `${y}/${m}/${d}`;
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
}

function addDays(dateStr, n) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateStr, n) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

function normalizeTask(t) {
  return {
    tags: [],
    subtasks: [],
    recurrence: null,
    order: 0,
    ...t,
  };
}

const RECURRENCE_LABEL = { daily: '毎日', weekly: '毎週', monthly: '毎月' };

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const PRIORITY_LABEL = { high: '高', medium: '中', low: '低' };
const STATUS_LABEL   = { todo: '未着手', inprogress: '進行中', done: '完了' };

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ===== Toast (with optional Undo) ===== */
function showToast(message, undoFn, duration = 5000) {
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
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-undo';
    btn.textContent = '元に戻す';
    btn.addEventListener('click', () => { undoFn(); dismiss(); });
    toast.appendChild(btn);
  }

  container.appendChild(toast);
  // entrance animation trigger
  requestAnimationFrame(() => toast.classList.add('toast-in'));
  timer = setTimeout(dismiss, duration);
  return dismiss;
}

/* ===== Task CRUD ===== */
function addTask(data) {
  state.tasks.push(normalizeTask({ id: uid(), createdAt: new Date().toISOString(), ...data }));
  saveCloud();
  render();
}

function updateTask(id, data) {
  const idx = state.tasks.findIndex(t => t.id === id);
  if (idx < 0) return;
  state.tasks[idx] = { ...state.tasks[idx], ...data };
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
  const becomingDone = task.status !== 'done';
  task.status = task.status === 'done' ? 'todo' : 'done';

  if (becomingDone && task.recurrence && task.recurrence.type) {
    spawnNextRecurrence(task);
  }

  saveCloud();
  render();
}

function nextRecurrenceDeadline(deadline, recurrence) {
  const base = deadline || new Date().toISOString().slice(0, 10);
  if (recurrence.type === 'daily')   return addDays(base, 1);
  if (recurrence.type === 'weekly')  return addDays(base, 7);
  if (recurrence.type === 'monthly') return addMonths(base, 1);
  return base;
}

function spawnNextRecurrence(task) {
  const next = normalizeTask({
    ...task,
    id: uid(),
    createdAt: new Date().toISOString(),
    status: 'todo',
    deadline: nextRecurrenceDeadline(task.deadline, task.recurrence),
    subtasks: (task.subtasks || []).map(s => ({ ...s, id: uid(), done: false })),
  });
  state.tasks.push(next);
  return next;
}

function skipRecurrence(id) {
  const idx = state.tasks.findIndex(t => t.id === id);
  if (idx < 0) return;
  const original = state.tasks[idx];
  if (!original.recurrence || !original.recurrence.type) return;

  const spawned = spawnNextRecurrence(original);
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveCloud();
  render();

  const dateLabel = formatDate(original.deadline) || '今回分';
  showToast(`「${original.title}」を${dateLabel}スキップしました`, () => {
    state.tasks = state.tasks.filter(t => t.id !== spawned.id); // 自動生成された次回分を取消
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
    ? `カテゴリ「${removed.name}」を削除（${affectedIds.length}件のタスクが「なし」になりました）`
    : `カテゴリ「${removed.name}」を削除しました`;
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
  let tasks = [...state.tasks];

  if (state.filters.categoryId)
    tasks = tasks.filter(t => t.categoryId === state.filters.categoryId);
  if (state.filters.priority)
    tasks = tasks.filter(t => t.priority === state.filters.priority);
  if (state.filters.status)
    tasks = tasks.filter(t => t.status === state.filters.status);
  if (state.filters.hideCompleted)
    tasks = tasks.filter(t => t.status !== 'done');
  if (state.filters.preset) {
    const today = new Date().toISOString().slice(0, 10);
    if (state.filters.preset === 'today') {
      tasks = tasks.filter(t => t.deadline === today);
    } else if (state.filters.preset === 'week') {
      const weekEnd = addDays(today, 6);
      tasks = tasks.filter(t => t.deadline && t.deadline >= today && t.deadline <= weekEnd);
    } else if (state.filters.preset === 'overdue') {
      tasks = tasks.filter(t => t.deadline && t.deadline < today && t.status !== 'done');
    }
  }
  if (state.filters.search) {
    const raw = state.filters.search.trim();
    if (raw.startsWith('#') && raw.length > 1) {
      const tagQuery = raw.slice(1).toLowerCase();
      tasks = tasks.filter(t =>
        (t.tags || []).some(tag => tag.toLowerCase() === tagQuery)
      );
    } else {
      const q = raw.toLowerCase();
      tasks = tasks.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.description && t.description.toLowerCase().includes(q)) ||
        (t.tags || []).some(tag => tag.toLowerCase().includes(q))
      );
    }
  }

  tasks.sort((a, b) => {
    // 完了タスクは選択中のソート種別に関わらず常に末尾
    const aDone = a.status === 'done' ? 1 : 0;
    const bDone = b.status === 'done' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;

    if (state.filters.sort === 'manual') {
      return (a.order ?? 0) - (b.order ?? 0);
    }
    if (state.filters.sort === 'deadline') {
      const da = a.deadline || '9999-99-99';
      const db = b.deadline || '9999-99-99';
      return da.localeCompare(db);
    }
    if (state.filters.sort === 'priority') {
      return (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return tasks;
}

/* ===== Badge HTML ===== */
function priorityBadgeHtml(priority) {
  return `<span class="badge badge-${priority}">${PRIORITY_LABEL[priority] || priority}</span>`;
}

function categoryBadgeHtml(categoryId) {
  const cat = getCategoryById(categoryId);
  if (!cat) return '';
  return `<span class="badge badge-category" style="background:${cat.color}22;color:${cat.color}">${escHtml(cat.name)}</span>`;
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
  if (!subtasks || subtasks.length === 0) return '';
  const done = subtasks.filter(s => s.done).length;
  const pct = Math.round((done / subtasks.length) * 100);
  const inner = `<span class="subtask-progress-bar"><span class="subtask-progress-fill" style="width:${pct}%"></span></span>
    <span class="subtask-progress-text">${done}/${subtasks.length}</span>`;
  // taskId 省略時（kanban 等）は従来通り非インタラクティブな span
  if (!taskId) {
    return `<span class="subtask-progress" title="サブタスク進捗">${inner}</span>`;
  }
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

    card.innerHTML = `
      <div class="task-check${task.status === 'done' ? ' checked' : ''}" data-action="toggle" data-id="${task.id}" title="完了切り替え"></div>
      <div class="task-body">
        <div class="task-title">${escHtml(task.title)}</div>
        ${task.description ? `<div class="task-desc">${escHtml(task.description)}</div>` : ''}
        <div class="task-meta">
          ${priorityBadgeHtml(task.priority)}
          ${categoryBadgeHtml(task.categoryId)}
          ${deadlineBadgeHtml(task.deadline)}
          ${recurrenceBadgeHtml(task.recurrence)}
          ${subtaskProgressHtml(task.subtasks, task.id, uiState.expanded.has(task.id))}
          <span class="badge badge-low">${STATUS_LABEL[task.status] || task.status}</span>
        </div>
        ${task.tags && task.tags.length ? `<div class="task-tags">${tagChipsHtml(task.tags)}</div>` : ''}
        ${task.subtasks?.length && uiState.expanded.has(task.id)
          ? `<div class="task-subtasks-inline" id="subtasks-${task.id}" role="group" aria-label="サブタスク">
              ${task.subtasks.map(s => `
                <label class="subtask-inline-row">
                  <input type="checkbox" class="subtask-inline-check"
                         data-action="toggle-subtask" data-id="${task.id}" data-sid="${s.id}"
                         ${s.done ? 'checked' : ''}>
                  <span class="subtask-inline-title${s.done ? ' done' : ''}">${escHtml(s.title)}</span>
                </label>
              `).join('')}
            </div>`
          : ''}
      </div>
      <div class="task-actions">
        ${task.recurrence?.type && task.status !== 'done' ? `<button class="btn-action skip" data-action="skip" data-id="${task.id}" title="今回だけスキップ（次回分は維持）" aria-label="今回だけスキップ">⏭</button>` : ''}
        <button class="btn-action" data-action="edit" data-id="${task.id}" title="編集">✏️</button>
        <button class="btn-action delete" data-action="delete" data-id="${task.id}" title="削除">🗑️</button>
      </div>
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

      card.innerHTML = `
        <div class="kanban-card-title">${escHtml(task.title)}</div>
        <div class="kanban-card-meta">
          ${priorityBadgeHtml(task.priority)}
          ${categoryBadgeHtml(task.categoryId)}
          ${deadlineBadgeHtml(task.deadline)}
          ${recurrenceBadgeHtml(task.recurrence)}
          ${subtaskProgressHtml(task.subtasks)}
        </div>
        ${task.tags && task.tags.length ? `<div class="kanban-card-tags">${tagChipsHtml(task.tags)}</div>` : ''}
        <div class="kanban-card-footer">
          <select class="kanban-status-select" data-action="status" data-id="${task.id}">${statusOptions}</select>
          <div class="kanban-actions">
            ${task.recurrence?.type && task.status !== 'done' ? `<button class="btn-action skip" data-action="skip" data-id="${task.id}" title="今回だけスキップ" aria-label="今回だけスキップ">⏭</button>` : ''}
            <button class="btn-action" data-action="edit" data-id="${task.id}" title="編集">✏️</button>
            <button class="btn-action delete" data-action="delete" data-id="${task.id}" title="削除">🗑️</button>
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
  filterEl.innerHTML = `<button class="category-chip${state.filters.categoryId === '' ? ' active' : ''}" data-category-id="">すべて</button>`;
  state.categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `category-chip${state.filters.categoryId === cat.id ? ' active' : ''}`;
    btn.dataset.categoryId = cat.id;
    btn.innerHTML = `<span class="category-dot" style="background:${cat.color}"></span>${escHtml(cat.name)}`;
    filterEl.appendChild(btn);
  });

  // Category manage list
  const manageEl = document.getElementById('categoryList');
  manageEl.innerHTML = '';
  state.categories.forEach(cat => {
    const item = document.createElement('div');
    item.className = 'category-manage-item';
    item.innerHTML = `
      <span class="category-dot" style="background:${cat.color}"></span>
      <span>${escHtml(cat.name)}</span>
      <button class="btn-delete-cat" data-action="delete-cat" data-id="${cat.id}" title="削除">✕</button>
    `;
    manageEl.appendChild(item);
  });
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

/* ===== Render (full) ===== */
function render() {
  renderStats();
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
    <input type="checkbox" class="subtask-check" ${subtask.done ? 'checked' : ''}>
    <input type="text" class="subtask-title-input" value="${escHtml(subtask.title)}" placeholder="サブタスクのタイトル">
    <button type="button" class="subtask-remove-btn" title="削除">✕</button>
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
  }

  modal.classList.remove('hidden');
  document.getElementById('taskTitle').focus();
}

function closeTaskModal() {
  document.getElementById('taskModal').classList.add('hidden');
}

/* ===== Modal: Category ===== */
function openCategoryModal() {
  document.getElementById('categoryName').value  = '';
  document.getElementById('categoryColor').value = '#CC0033';
  document.getElementById('categoryColorHex').textContent = '#CC0033';
  document.getElementById('categoryModal').classList.remove('hidden');
  document.getElementById('categoryName').focus();
}

function closeCategoryModal() {
  document.getElementById('categoryModal').classList.add('hidden');
}

/* ===== Event Delegation ===== */
function handleGlobalClick(e) {
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

  if (action === 'toggle')      { toggleDone(id); return; }
  if (action === 'edit')        { openTaskModal(state.tasks.find(t => t.id === id)); return; }
  if (action === 'delete')      { deleteTask(id); return; }
  if (action === 'delete-cat')  { deleteCategory(id); return; }
  if (action === 'sync-retry')  { saveCloud(); return; }
  if (action === 'skip')        { skipRecurrence(id); return; }
  if (action === 'toggle-subtasks') {
    if (uiState.expanded.has(id)) uiState.expanded.delete(id);
    else                          uiState.expanded.add(id);
    render();
    return;
  }
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
  const data = {
    title:       document.getElementById('taskTitle').value.trim(),
    description: document.getElementById('taskDescription').value.trim(),
    deadline:    document.getElementById('taskDeadline').value,
    priority:    document.getElementById('taskPriority').value,
    categoryId:  document.getElementById('taskCategory').value,
    status:      document.getElementById('taskStatus').value,
    tags,
    subtasks:    collectSubtasks(),
    recurrence:  recurrenceType ? { type: recurrenceType, interval: 1 } : null,
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
  document.getElementById('hamburgerBtn').classList.add('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('visible');
  document.getElementById('hamburgerBtn').classList.remove('open');
}

function toggleSidebar() {
  const isOpen = document.getElementById('sidebar').classList.contains('open');
  isOpen ? closeSidebar() : openSidebar();
}

/* ===== View toggle helper ===== */
function switchView(view) {
  state.currentView = view;
  const isList = view === 'list';
  ['listViewBtn', 'listViewBtnMobile'].forEach(id => {
    document.getElementById(id)?.classList.toggle('active', isList);
  });
  ['kanbanViewBtn', 'kanbanViewBtnMobile'].forEach(id => {
    document.getElementById(id)?.classList.toggle('active', !isList);
  });
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
    if (e.target.closest('.task-subtasks-inline, .subtask-toggle, .task-actions')) {
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

  if (task.status !== status) task.status = status;

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

/* ===== Init ===== */
async function init() {
  await loadStorage();
  applyTheme(state.theme);
  applyFontSize(localStorage.getItem(FONTSIZE_KEY) || 'standard');
  renderSidebar();
  render();

  /* リアルタイム同期: 他デバイスの変更を自動反映 */
  onSnapshot(DATA_DOC, (snap) => {
    if (!snap.exists()) return;
    const d = snap.data();
    state.tasks      = (d.tasks      || []).map(normalizeTask);
    state.categories = d.categories || [];
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
    if (quickAddMeta.deadlinePreset === 'today')    return new Date().toISOString().slice(0, 10);
    if (quickAddMeta.deadlinePreset === 'tomorrow') return addDays(new Date().toISOString().slice(0, 10), 1);
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
      document.querySelectorAll('.preset-chip').forEach(c => {
        const isActive = c === chip;
        c.classList.toggle('active', isActive);
        c.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
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
  }, { passive: true });

  /* Global delegation */
  document.addEventListener('click', handleGlobalClick);
  document.addEventListener('change', handleGlobalChange);

  /* Swipe gestures (mobile list view) */
  initSwipeGestures();

  /* D&D drop zones (desktop only) */
  initDragDropZones();

  /* Online / offline detection */
  window.addEventListener('offline', () => setSyncState('offline'));
  window.addEventListener('online',  () => saveCloud()); // 復帰時に自動リトライ
  if (navigator.onLine === false) setSyncState('offline');

  /* Keyboard shortcuts */
  document.addEventListener('keydown', handleKeyboardShortcut);
}

/* ===== Keyboard Shortcuts =====
   N : クイック追加バーにフォーカス
   / : 検索バーにフォーカス
   Esc: 開いているモーダルを閉じる / フォーカス中の入力をぼかす
*/
function handleKeyboardShortcut(e) {
  // モディファイア付きはブラウザ標準操作を優先
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const target = e.target;
  const tag    = (target?.tagName || '').toUpperCase();
  const isTyping =
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
    target?.isContentEditable;

  // Esc は常に効かせる（モーダル閉じ / 入力からのフォーカス外し）
  if (e.key === 'Escape') {
    const taskModal = document.getElementById('taskModal');
    const catModal  = document.getElementById('categoryModal');
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
    if (isTyping && typeof target.blur === 'function') {
      target.blur();
      e.preventDefault();
    }
    return;
  }

  // 入力中・モーダル表示中は N と / を無効化
  if (isTyping) return;
  const taskModalOpen = !document.getElementById('taskModal')?.classList.contains('hidden');
  const catModalOpen  = !document.getElementById('categoryModal')?.classList.contains('hidden');
  if (taskModalOpen || catModalOpen) return;

  if (e.key === 'n' || e.key === 'N') {
    const input = document.getElementById('quickAddInput');
    if (input) { input.focus(); input.select?.(); e.preventDefault(); }
    return;
  }
  if (e.key === '/') {
    const input = document.getElementById('searchInput');
    if (input) { input.focus(); input.select?.(); e.preventDefault(); }
  }
}

document.addEventListener('DOMContentLoaded', init);
