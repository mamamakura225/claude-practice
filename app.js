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

/* ===== localStorage ===== */
const TASKS_KEY = 'dtask_tasks';
const CATS_KEY  = 'dtask_categories';
const THEME_KEY = 'dtask_theme';

function loadStorage() {
  try {
    state.tasks      = JSON.parse(localStorage.getItem(TASKS_KEY))  || [];
    state.categories = JSON.parse(localStorage.getItem(CATS_KEY))   || [];
  } catch {
    state.tasks = [];
    state.categories = [];
  }
  state.theme = localStorage.getItem(THEME_KEY) || 'light';
}

function saveTasks()      { localStorage.setItem(TASKS_KEY, JSON.stringify(state.tasks)); }
function saveCategories() { localStorage.setItem(CATS_KEY,  JSON.stringify(state.categories)); }

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
  saveTasks();
  render();
}

function updateTask(id, data) {
  const idx = state.tasks.findIndex(t => t.id === id);
  if (idx < 0) return;
  state.tasks[idx] = { ...state.tasks[idx], ...data };
  saveTasks();
  render();
}

function deleteTask(id) {
  const card = document.querySelector(`.task-card[data-id="${id}"], .kanban-card[data-id="${id}"]`);
  if (card) {
    card.classList.add('removing');
    setTimeout(() => {
      state.tasks = state.tasks.filter(t => t.id !== id);
      saveTasks();
      render();
    }, 230);
  } else {
    state.tasks = state.tasks.filter(t => t.id !== id);
    saveTasks();
    render();
  }
}

function toggleDone(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  task.status = task.status === 'done' ? 'todo' : 'done';
  saveTasks();
  render();
}

/* ===== Category CRUD ===== */
function addCategory(name, color) {
  state.categories.push({ id: uid(), name, color });
  saveCategories();
  renderSidebar();
  populateCategorySelect();
}

function deleteCategory(id) {
  state.categories = state.categories.filter(c => c.id !== id);
  state.tasks.forEach(t => { if (t.categoryId === id) t.categoryId = ''; });
  saveCategories();
  saveTasks();
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
  container.querySelectorAll('.task-card').forEach(el => el.remove());

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
    container.appendChild(card);
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

/* ===== Init ===== */
function init() {
  loadStorage();
  applyTheme(state.theme);
  renderSidebar();
  render();

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
}

document.addEventListener('DOMContentLoaded', init);
