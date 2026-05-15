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
    sort: 'createdAt',
    search: '',
  },
  theme: 'light',
};

/* ===== Swipe Gesture State ===== */
const SWIPE_THRESHOLD    = 80;
const SWIPE_AUTO_TRIGGER = 160;
const swipeState = {
  active: false, startX: 0, startY: 0, currentX: 0,
  card: null, wrapper: null, id: null, canceled: false,
};
let swipeDidMove = false;

/* ===== Storage ===== */
const THEME_KEY = 'dtask_theme';

function setSyncStatus(msg) {
  const el = document.getElementById('syncIndicator');
  if (el) el.textContent = msg;
}

async function saveCloud() {
  setSyncStatus('同期中…');
  await setDoc(DATA_DOC, { tasks: state.tasks, categories: state.categories });
  setSyncStatus('✓ 保存済み');
  setTimeout(() => setSyncStatus(''), 2000);
}

async function loadStorage() {
  state.theme = localStorage.getItem(THEME_KEY) || 'light';

  const snap = await getDoc(DATA_DOC);
  if (snap.exists()) {
    const d = snap.data();
    state.tasks      = d.tasks      || [];
    state.categories = d.categories || [];
  } else {
    // 初回: localStorageにデータがあればFirestoreへ移行
    try {
      state.tasks      = JSON.parse(localStorage.getItem('dtask_tasks'))      || [];
      state.categories = JSON.parse(localStorage.getItem('dtask_categories')) || [];
    } catch {
      state.tasks = []; state.categories = [];
    }
    if (state.tasks.length || state.categories.length) await saveCloud();
  }
}

/* ===== Theme ===== */
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
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

/* ===== Task CRUD ===== */
function addTask(data) {
  state.tasks.push({ id: uid(), createdAt: new Date().toISOString(), ...data });
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
  const card = document.querySelector(`.task-card[data-id="${id}"], .kanban-card[data-id="${id}"]`);
  if (card) {
    card.classList.add('removing');
    setTimeout(() => {
      state.tasks = state.tasks.filter(t => t.id !== id);
      saveCloud();
      render();
    }, 230);
  } else {
    state.tasks = state.tasks.filter(t => t.id !== id);
    saveCloud();
    render();
  }
}

function toggleDone(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  task.status = task.status === 'done' ? 'todo' : 'done';
  saveCloud();
  render();
}

/* ===== Category CRUD ===== */
function addCategory(name, color) {
  state.categories.push({ id: uid(), name, color });
  saveCloud();
  renderSidebar();
  populateCategorySelect();
}

function deleteCategory(id) {
  state.categories = state.categories.filter(c => c.id !== id);
  state.tasks.forEach(t => { if (t.categoryId === id) t.categoryId = ''; });
  saveCloud();
  if (state.filters.categoryId === id) state.filters.categoryId = '';
  renderSidebar();
  populateCategorySelect();
  render();
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
  if (state.filters.search) {
    const q = state.filters.search.toLowerCase();
    tasks = tasks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.description && t.description.toLowerCase().includes(q))
    );
  }

  tasks.sort((a, b) => {
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
          <span class="badge badge-low">${STATUS_LABEL[task.status] || task.status}</span>
        </div>
      </div>
      <div class="task-actions">
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
        </div>
        <div class="kanban-card-footer">
          <select class="kanban-status-select" data-action="status" data-id="${task.id}">${statusOptions}</select>
          <div class="kanban-actions">
            <button class="btn-action" data-action="edit" data-id="${task.id}" title="編集">✏️</button>
            <button class="btn-action delete" data-action="delete" data-id="${task.id}" title="削除">🗑️</button>
          </div>
        </div>
      `;
      container.appendChild(card);
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

/* ===== Modal: Task ===== */
function openTaskModal(task = null) {
  const modal    = document.getElementById('taskModal');
  const title    = document.getElementById('taskModalTitle');
  const idInput  = document.getElementById('taskId');

  populateCategorySelect();

  if (task) {
    title.textContent                                = 'タスク編集';
    idInput.value                                    = task.id;
    document.getElementById('taskTitle').value       = task.title;
    document.getElementById('taskDescription').value = task.description || '';
    document.getElementById('taskDeadline').value    = task.deadline || '';
    document.getElementById('taskPriority').value    = task.priority;
    document.getElementById('taskCategory').value    = task.categoryId || '';
    document.getElementById('taskStatus').value      = task.status;
  } else {
    title.textContent = 'タスク追加';
    document.getElementById('taskForm').reset();
    idInput.value = '';
    document.getElementById('taskPriority').value = 'medium';
    document.getElementById('taskStatus').value   = 'todo';
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
}

function handleGlobalChange(e) {
  const el = e.target.closest('[data-action="status"]');
  if (el) { updateTask(el.dataset.id, { status: el.value }); }
}

/* ===== Task form submit ===== */
function handleTaskFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('taskId').value;
  const data = {
    title:       document.getElementById('taskTitle').value.trim(),
    description: document.getElementById('taskDescription').value.trim(),
    deadline:    document.getElementById('taskDeadline').value,
    priority:    document.getElementById('taskPriority').value,
    categoryId:  document.getElementById('taskCategory').value,
    status:      document.getElementById('taskStatus').value,
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
    card.style.transform = '';
    card.addEventListener('transitionend', () => card.classList.remove('snap-back'), { once: true });
  }

  function doDelete() {
    card.classList.remove('is-swiping');
    card.classList.add('snap-back');
    card.style.transform = 'translateX(-110%)';
    card.addEventListener('transitionend', () => {
      wrapper.remove();
      state.tasks = state.tasks.filter(t => t.id !== id);
      saveCloud();
      render();
    }, { once: true });
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
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    currentX = t.clientX;
    active = true;
    canceled = false;
  }, { passive: true });

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

    currentX = t.clientX;
    card.style.transform = `translateX(${dx}px)`;
    wrapper.classList.toggle('swiping',          Math.abs(dx) > 10);
    wrapper.classList.toggle('swiping-left',     dx < -10);
    wrapper.classList.toggle('swiping-right',    dx > 10);
    wrapper.classList.toggle('trigger-delete',   dx < -SWIPE_AUTO_TRIGGER);
    wrapper.classList.toggle('trigger-complete', dx > SWIPE_AUTO_TRIGGER);
  }, { passive: true });

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

/* ===== Init ===== */
async function init() {
  await loadStorage();
  applyTheme(state.theme);
  renderSidebar();
  render();

  /* リアルタイム同期: 他デバイスの変更を自動反映 */
  onSnapshot(DATA_DOC, (snap) => {
    if (!snap.exists()) return;
    const d = snap.data();
    state.tasks      = d.tasks      || [];
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

  /* Task modal close */
  document.getElementById('closeTaskModal').addEventListener('click', closeTaskModal);
  document.getElementById('cancelTaskModal').addEventListener('click', closeTaskModal);
  document.getElementById('taskModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTaskModal();
  });

  /* Task form */
  document.getElementById('taskForm').addEventListener('submit', handleTaskFormSubmit);

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
}

document.addEventListener('DOMContentLoaded', init);
