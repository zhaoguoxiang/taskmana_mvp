/**
 * TaskMana SPA — simple task list + CRUD modals + graph visualization.
 *
 * Views:  任务列表 (kanban by status), 图视图 (Cytoscape graph)
 * Modals: 新建/编辑任务, 任务详情（含链接管理）
 */

/* ── Status / Type labels ──────────────────────────────────────────────── */
const STATUS_LABEL = {
  todo: '未开始', in_progress: '进行中', blocked: '阻塞中',
  done: '已完成', cancelled: '已取消', paused: '已暂停',
};
const STATUS_CSS = {
  todo: 'status-todo', in_progress: 'status-in_progress', blocked: 'status-blocked',
  done: 'status-done', cancelled: 'status-cancelled', paused: 'status-paused',
};
const TYPE_ICON = { execution: '🔨', communication: '💬', composite: '📦' };
const LINK_LABEL = { contains: '包含', blocks: '阻塞', derives: '派生' };
const CARD_DELAY_STEPS = 8;

/* ═══════════════════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════════════════ */
let currentView = 'kanban';
let cyInstance = null;

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAuth();
  initLoginForm();
});

/* ── Auth ─────────────────────────────────────────────────────────────── */
function initAuth() {
  // Listen for 401 responses (token expired / invalid)
  window.addEventListener('taskmana:unauthorized', () => {
    showLogin();
  });

  // Logout button
  document.getElementById('btn-logout').addEventListener('click', () => {
    API.clearToken();
    showLogin();
  });

  // Check existing token
  if (API.isAuthenticated()) {
    // Validate token by calling /auth/me
    API.me().then(user => {
      API.setUser(user);
      showApp(user);
    }).catch(() => {
      showLogin();
    });
  } else {
    showLogin();
  }
}

function initLoginForm() {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) return;

    submitBtn.disabled = true;
    submitBtn.textContent = '登录中…';
    errorEl.hidden = true;

    try {
      const resp = await API.login(username, password);
      API.setToken(resp.access_token);
      API.setUser(resp.user);
      showApp(resp.user);
    } catch (err) {
      errorEl.textContent = err.message || '登录失败';
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '登 录';
    }
  });
}

function showLogin() {
  document.getElementById('login-page').hidden = false;
  document.getElementById('app-root').hidden = true;
  // Kill graph if running
  if (cyInstance) { cyInstance.destroy(); cyInstance = null; }
}

function showApp(user) {
  document.getElementById('login-page').hidden = true;
  document.getElementById('app-root').hidden = false;
  document.getElementById('header-username').textContent = user?.username || '';

  // Lazy init: only set up modals/tabs if not already done
  if (!document.getElementById('app-root').dataset.initialized) {
    document.getElementById('app-root').dataset.initialized = '1';
    initModals();
    initTabs();
    initTaskForm();
  }
  refreshTaskList();
}

/* ── Theme Toggle ─────────────────────────────────────────────────────── */
function initTheme() {
  const toggle = document.getElementById('btn-theme');
  const saved = localStorage.getItem('taskmana_theme');
  if (saved) {
    document.documentElement.dataset.theme = saved;
    toggle.textContent = saved === 'dark' ? '🌙' : '☀️';
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.dataset.theme = 'dark';
    toggle.textContent = '🌙';
  }

  toggle.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme;
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    toggle.textContent = next === 'dark' ? '🌙' : '☀️';
    localStorage.setItem('taskmana_theme', next);
    toggle.style.transform = 'rotate(180deg) scale(1.2)';
    setTimeout(() => { toggle.style.transform = ''; }, 300);
    onThemeChanged();
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('taskmana_theme')) {
      const next = e.matches ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      toggle.textContent = next === 'dark' ? '🌙' : '☀️';
      onThemeChanged();
    }
  });
}

/* Global theme-change handler: re-render graph if visible */
function onThemeChanged() {
  if (currentView === 'graph' && cyInstance) {
    renderGraph();
  }
}

/* ── Modal open/close ───────────────────────────────────────────────────── */
function initModals() {
  document.getElementById('btn-new-task').addEventListener('click', () => openTaskModal());
  document.addEventListener('click', e => {
    const closer = e.target.closest('[data-close]');
    if (closer) document.getElementById(closer.dataset.close).close();
  });
  document.querySelectorAll('.modal').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
  });

  /* Markdown editor modal — save button + cleanup on close */
  document.getElementById('btn-md-save').addEventListener('click', () => _saveMdEditor());
  document.getElementById('modal-md').addEventListener('close', () => _closeMdEditor());
}

/* ── Tab switching ──────────────────────────────────────────────────────── */
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      if (view === currentView) return;
      switchView(view);
    });
  });
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  const main = document.getElementById('app-main');
  const graph = document.getElementById('graph-container');

  if (view === 'graph') {
    main.hidden = true;
    graph.hidden = false;
    renderGraph();
  } else {
    graph.hidden = true;
    main.hidden = false;
    if (cyInstance) { cyInstance.destroy(); cyInstance = null; }
    refreshTaskList();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TASK LIST VIEW (Kanban)
   ═══════════════════════════════════════════════════════════════════════════ */
async function refreshTaskList() {
  if (currentView === 'graph') { renderGraph(); return; }
  const main = document.getElementById('app-main');
  main.innerHTML = renderSkeletonKanban();
  try {
    const tasks = await fetchAllTasks();
    renderTaskList(main, tasks);
  } catch (e) {
    main.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span>加载失败: ${esc(e.message)}</div>`;
  }
}

function renderSkeletonKanban() {
  const cols = ['未开始', '进行中', '阻塞中', '已完成', '已暂停', '已取消'];
  let html = '<div class="kanban">';
  for (const label of cols) {
    const count = 2 + Math.floor(Math.random() * 3);
    html += `<div class="kanban-col">`;
    html += `<div class="kanban-col-header">${label} <span class="count">—</span></div>`;
    html += `<div class="kanban-col-body">`;
    for (let i = 0; i < count; i++) {
      html += `<div class="skeleton skeleton-card"></div>`;
    }
    html += `</div></div>`;
  }
  html += '</div>';
  return html;
}

async function fetchAllTasks() {
  try { return await API.listAllTasks(); }
  catch (_) { return []; }
}

function renderTaskList(container, tasks) {
  if (tasks.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">📋</span>暂无任务<br><small>点击「＋ 新建任务」开始</small></div>';
    return;
  }

  const groups = { todo: [], in_progress: [], blocked: [], done: [], paused: [], cancelled: [] };
  for (const t of tasks) {
    (groups[t.status] = groups[t.status] || []).push(t);
  }

  let cardIndex = 0;
  const columns = ['todo', 'in_progress', 'blocked', 'done', 'paused', 'cancelled'];
  let html = '<div class="kanban">';
  for (const status of columns) {
    const items = groups[status] || [];
    html += `<div class="kanban-col" data-status="${status}">`;
    html += `<div class="kanban-col-header">${STATUS_LABEL[status]} <span class="count">${items.length}</span></div>`;
    html += `<div class="kanban-col-body" data-status="${status}">`;
    for (const t of items) {
      html += taskCard(t, cardIndex);
      cardIndex++;
    }
    html += `</div></div>`;
  }
  html += '</div>';
  container.innerHTML = html;
  container.querySelectorAll('.task-card[data-delay]').forEach(card => {
    card.style.setProperty('--card-delay', `${parseInt(card.dataset.delay) * 0.04}s`);
  });
  bindCardInteractions(container);
}

function taskCard(t, index) {
  const typeIcon = TYPE_ICON[t.task_type] || '';
  const statusClass = STATUS_CSS[t.status] || '';
  const title = esc(t.title || '');
  const desc = t.description ? esc(t.description) : '';
  const people = t.people?.length ? '👥 ' + t.people.join(', ') : '';
  const deadline = t.deadline ? new Date(t.deadline).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '';
  const deadlineFull = t.deadline ? new Date(t.deadline).toLocaleDateString('zh-CN') : '';
  const tags = t.tags?.length ? t.tags.map(x => `<span class="tag">${esc(x)}</span>`).join('') : '';
  const delayStep = Math.min(index || 0, CARD_DELAY_STEPS);
  const planHas = t.plan ? 'has-content' : '';
  const logHas = t.log ? 'has-content' : '';
  const reviewHas = t.review ? 'has-content' : '';
  return `
    <div class="task-card ${statusClass}" data-task-id="${t.id}" data-status="${t.status}" draggable="true" data-delay="${delayStep}">
      <div class="tc-desc"><span class="task-id">#${t.id}</span> ${typeIcon} ${title}</div>
      ${desc ? `<div class="tc-desc-sub">${desc}</div>` : ''}
      ${tags ? `<div class="tc-tags">${tags}</div>` : ''}
      ${deadlineFull ? `<div class="tc-deadline">📅 ${deadlineFull}</div>` : `<div class="tc-deadline tc-deadline-none">📅 无截止</div>`}
      <div class="tc-meta">
        ${people ? `<span>${people}</span>` : ''}
        ${t.duration ? `<span>⏱ ${t.duration}min</span>` : ''}
      </div>
      <div class="tc-actions">
        <button class="tc-action-btn ${planHas}" data-task-id="${t.id}" data-field="plan">📋 计划</button>
        <button class="tc-action-btn ${logHas}" data-task-id="${t.id}" data-field="log">📝 日志</button>
        <button class="tc-action-btn ${reviewHas}" data-task-id="${t.id}" data-field="review">🔍 复盘</button>
      </div>
    </div>`;
}

function bindCardInteractions(container) {
  let draggedCard = null;
  let dragSourceStatus = null;

  /* ── Click on markdown action buttons (Plan / Log / Review) ──
     Uses capture phase to intercept before card's bubble handler */
  container.addEventListener('click', e => {
    const btn = e.target.closest('.tc-action-btn');
    if (!btn) return;
    e.stopPropagation();
    const taskId = parseInt(btn.dataset.taskId);
    const field = btn.dataset.field;
    if (taskId && field) openMdEditorForTask(taskId, field);
  }, true);  /* capture phase */

  /* ── Click to open detail ── */
  container.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', () => openDetailModal(parseInt(card.dataset.taskId)));

    /* ── Drag start ── */
    card.addEventListener('dragstart', e => {
      draggedCard = card;
      dragSourceStatus = card.dataset.status;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.taskId);
      // Let the drag image be the card itself at half opacity
      setTimeout(() => { if (card.classList.contains('dragging')) card.style.opacity = '0.4'; }, 0);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      card.style.opacity = '';
      draggedCard = null;
      dragSourceStatus = null;
      // Remove all drag-over highlights
      container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
  });

  /* ── Drop targets: kanban-col-body ── */
  container.querySelectorAll('.kanban-col-body').forEach(body => {
    body.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      body.classList.add('drag-over');
    });

    body.addEventListener('dragenter', e => {
      e.preventDefault();
      body.classList.add('drag-over');
    });

    body.addEventListener('dragleave', e => {
      // Only remove if we actually left the body (not entering a child)
      if (!body.contains(e.relatedTarget)) {
        body.classList.remove('drag-over');
      }
    });

    body.addEventListener('drop', async e => {
      e.preventDefault();
      body.classList.remove('drag-over');

      if (!draggedCard) return;

      const newStatus = body.dataset.status;
      if (!newStatus || newStatus === dragSourceStatus) return;

      const taskId = parseInt(draggedCard.dataset.taskId);

      // Optimistic UI: move the card immediately
      draggedCard.dataset.status = newStatus;
      draggedCard.className = draggedCard.className.replace(/status-\S+/g, '');
      draggedCard.classList.add(STATUS_CSS[newStatus] || '');
      // Update the ::before gradient by swapping status classes
      if (newStatus === 'done' || newStatus === 'cancelled') {
        draggedCard.classList.add(newStatus === 'done' ? 'status-done' : 'status-cancelled');
      } else {
        draggedCard.classList.remove('status-done', 'status-cancelled');
      }
      body.appendChild(draggedCard);

      try {
        await API.updateTask(taskId, { status: newStatus });
        toast(`状态已更新为「${STATUS_LABEL[newStatus]}」`, 'success');
        // Refresh counts
        refreshTaskList();
      } catch (err) {
        toast(err.message, 'error');
        refreshTaskList(); // Revert on error
      }
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   MODAL: New / Edit Task
   ═══════════════════════════════════════════════════════════════════════════ */

let _originalTaskData = null;   /* cached when editing; cleared on close / new */

function openTaskModal(taskData) {
  const modal = document.getElementById('modal-task');
  const form = document.getElementById('form-task');
  form.reset();
  document.getElementById('ft-id').value = '';

  if (taskData) {
    _originalTaskData = taskData;
    document.getElementById('modal-task-title').textContent = '编辑任务';
    document.getElementById('ft-id').value = taskData.id;
    document.getElementById('ft-title').value = taskData.title || '';
    document.getElementById('ft-description').value = taskData.description || '';
    document.getElementById('ft-task-type').value = taskData.task_type || 'execution';
    document.getElementById('ft-status').value = taskData.status || 'todo';
    document.getElementById('ft-tags').value = (taskData.tags || []).join(', ');
    document.getElementById('ft-source').value = taskData.source || '';
    if (taskData.deadline) document.getElementById('ft-deadline').value = taskData.deadline.slice(0, 16);
    document.getElementById('ft-duration').value = taskData.duration || '';
    document.getElementById('ft-people').value = (taskData.people || []).join(', ');
    document.getElementById('ft-location').value = taskData.location || '';
  } else {
    _originalTaskData = null;
    document.getElementById('modal-task-title').textContent = '新建任务';
  }
  modal.showModal();
}

function initTaskForm() {
  document.getElementById('form-task').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = '保存中…';

    const id = document.getElementById('ft-id').value;
    const isEdit = !!id;

    const titleVal = document.getElementById('ft-title').value.trim();
    const descVal = document.getElementById('ft-description').value.trim();
    const data = {
      title: titleVal,
      description: descVal || null,
      task_type: document.getElementById('ft-task-type').value,
      status: document.getElementById('ft-status').value,
      tags: parseCsv(document.getElementById('ft-tags').value),
      source: document.getElementById('ft-source').value.trim() || null,
      deadline: document.getElementById('ft-deadline').value
        ? new Date(document.getElementById('ft-deadline').value).toISOString() : null,
      duration: document.getElementById('ft-duration').value
        ? parseInt(document.getElementById('ft-duration').value) : null,
      people: parseCsv(document.getElementById('ft-people').value),
      location: document.getElementById('ft-location').value.trim() || null,
    };

    try {
      let task;
      if (isEdit) {
        const patch = diffForPatch(data, _originalTaskData);
        if (Object.keys(patch).length === 0) {
          document.getElementById('modal-task').close();
          toast('没有变更', 'success');
          return;
        }
        task = await API.updateTask(parseInt(id), patch);
      } else {
        task = await API.createTask(data);
        const ids = JSON.parse(localStorage.getItem('taskmana_task_ids') || '[]');
        ids.push(task.id);
        localStorage.setItem('taskmana_task_ids', JSON.stringify(ids));
      }
      document.getElementById('modal-task').close();
      toast(isEdit ? '任务已更新' : '任务已创建', 'success');
      refreshTaskList();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '保存';
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   MODAL: Task Detail
   ═══════════════════════════════════════════════════════════════════════════ */
async function openDetailModal(taskId) {
  const modal = document.getElementById('modal-detail');
  const body = document.getElementById('detail-body');
  body.innerHTML = '<div class="detail-loading"><span class="spinner"></span></div>';
  modal.showModal();

  try {
    const t = await API.readTask(taskId);
    renderDetail(t, body);
    bindDetailActions(t);
  } catch (e) {
    body.innerHTML = `<div class="detail-error">加载失败: ${esc(e.message)}</div>`;
  }
}

function renderDetail(t, container) {
  const status = STATUS_LABEL[t.status] || t.status;
  const typeIcon = TYPE_ICON[t.task_type] || '';

  let html = '';
  html += `<h3 class="detail-title">${typeIcon} ${esc(t.title || t.description)}</h3>`;

  html += '<div class="detail-section"><h3>基本信息</h3><div class="detail-grid">';
  html += kv('标题', esc(t.title || '—'));
  html += kv('描述', esc(t.description || '—'));
  html += kv('状态', status);
  html += kv('类型', t.task_type);
  html += kv('来源', esc(t.source || '—'));
  html += kv('标签', (t.tags || []).join(', ') || '—');
  html += kv('人员', (t.people || []).join(', ') || '—');
  html += kv('地点', esc(t.location || '—'));
  html += kv('截止时间', t.deadline ? new Date(t.deadline).toLocaleString('zh-CN') : '—');
  html += kv('预计耗时', t.duration ? t.duration + ' 分钟' : '—');
  html += kv('创建时间', t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : '—');
  html += kv('更新时间', t.updated_at ? new Date(t.updated_at).toLocaleString('zh-CN') : '—');
  html += '</div></div>';

  html += '<div class="detail-section"><h3 class="detail-section-title">链接 <button class="btn btn-xs btn-secondary" data-action="add-link">＋ 添加</button></h3><div id="detail-links">加载中…</div></div>';
  container.innerHTML = html;
  loadDetailLinks(t.id);
}

async function loadDetailLinks(taskId) {
  const container = document.getElementById('detail-links');
  try {
    const allLinks = await API.listAllLinks().catch(() => []);
    const links = allLinks.filter(lnk => lnk.from_task_id === taskId || lnk.to_task_id === taskId);

    if (links.length === 0) {
      container.innerHTML = '<p class="detail-muted">暂无链接</p>';
      return;
    }

    let html = '';
    for (const lnk of links) {
      const label = LINK_LABEL[lnk.link_type] || lnk.link_type;
      const dir = lnk.from_task_id === taskId ? '→' : '←';
      const otherId = lnk.from_task_id === taskId ? lnk.to_task_id : lnk.from_task_id;
      html += `<div class="detail-rel">`;
      html += `<span>${label} ${dir} </span>`;
      html += `<a href="#" class="clickable" data-task-id="${otherId}">#${otherId}</a>`;
      if (lnk.note) html += ` <span class="detail-rel-note">— ${esc(lnk.note)}</span>`;
      html += ` <button class="btn btn-sm btn-danger detail-rel-delete" data-delete-link="${lnk.id}">删除</button>`;
      html += `</div>`;
    }
    container.innerHTML = html;

    container.querySelectorAll('[data-delete-link]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await API.deleteLink(parseInt(btn.dataset.deleteLink));
        toast('链接已删除', 'success');
        loadDetailLinks(taskId);
      });
    });
  } catch (e) {
    container.innerHTML = `<p class="detail-error">${esc(e.message)}</p>`;
  }
}

function bindDetailActions(t) {
  const container = document.getElementById('detail-body');

  /* Inject delete button into modal header */
  const modalHeader = document.querySelector('#modal-detail .modal-header');
  const existingDelBtn = modalHeader.querySelector('.modal-delete-btn');
  if (existingDelBtn) existingDelBtn.remove();
  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-xs btn-danger modal-delete-btn';
  delBtn.textContent = '🗑 删除';
  delBtn.addEventListener('click', async () => {
    if (!confirm('确定要删除此任务及其所有链接？')) return;
    try {
      await API.deleteTask(t.id);
      const ids = JSON.parse(localStorage.getItem('taskmana_task_ids') || '[]');
      localStorage.setItem('taskmana_task_ids', JSON.stringify(ids.filter(x => x !== t.id)));
      toast('任务已删除', 'success');
      document.getElementById('modal-detail').close();
      refreshTaskList();
    } catch (err) { toast(err.message, 'error'); }
  });
  const closeBtn = modalHeader.querySelector('.btn-close');
  closeBtn.parentNode.insertBefore(delBtn, closeBtn);

  let html = '<div class="detail-actions">';

  for (const ns of ['todo', 'in_progress', 'blocked', 'done', 'paused', 'cancelled']) {
    if (ns !== t.status) {
      html += `<button class="status-pill" data-action="set-status" data-new-status="${ns}">→ ${STATUS_LABEL[ns]}</button>`;
    }
  }
  html += `<button class="btn btn-sm btn-secondary" data-action="edit">✏️ 编辑</button>`;
  html += '</div>';
  container.insertAdjacentHTML('beforeend', html);

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      if (action === 'set-status') {
        await API.updateTask(t.id, { status: btn.dataset.newStatus });
        toast(`状态已更新为「${STATUS_LABEL[btn.dataset.newStatus]}」`, 'success');
        document.getElementById('modal-detail').close();
        refreshTaskList();
      } else if (action === 'edit') {
        document.getElementById('modal-detail').close();
        openTaskModal(t);
      } else if (action === 'add-link') {
        showInlineLinkForm(t, btn);
      } else if (action === 'delete') {
        if (!confirm('确定要删除此任务及其所有链接？')) return;
        try {
          await API.deleteTask(t.id);
          const ids = JSON.parse(localStorage.getItem('taskmana_task_ids') || '[]');
          localStorage.setItem('taskmana_task_ids', JSON.stringify(ids.filter(x => x !== t.id)));
          toast('任务已删除', 'success');
          document.getElementById('modal-detail').close();
          refreshTaskList();
        } catch (err) { toast(err.message, 'error'); }
      }
    });
  });
}

function showInlineLinkForm(t, triggerBtn) {
  const linksDiv = document.getElementById('detail-links');
  // Remove any existing inline form
  const old = linksDiv.querySelector('.inline-link-form');
  if (old) old.remove();

  const form = document.createElement('div');
  form.className = 'inline-link-form';
  form.innerHTML = `
    <div class="detail-rel inline-link-row">
      <input class="inline-link-target" type="number" id="il-target" placeholder="目标ID" min="1">
      <select class="inline-link-type" id="il-type">
        <option value="blocks">🚫 阻塞</option>
        <option value="contains">📦 包含</option>
        <option value="derives">🌱 派生</option>
      </select>
      <button class="btn btn-xs btn-primary" id="il-submit">确认</button>
      <button class="btn btn-xs btn-secondary" id="il-cancel">取消</button>
    </div>
  `;
  linksDiv.appendChild(form);

  document.getElementById('il-cancel').addEventListener('click', () => form.remove());
  document.getElementById('il-submit').addEventListener('click', async () => {
    const toId = parseInt(document.getElementById('il-target').value);
    const type = document.getElementById('il-type').value;
    if (!toId) { toast('请输入目标 ID', 'error'); return; }
    const btn = document.getElementById('il-submit');
    btn.disabled = true; btn.textContent = '…';
    try {
      const result = await API.createLink({ from_task_id: t.id, to_task_id: toId, link_type: type });
      const ids = JSON.parse(localStorage.getItem('taskmana_link_ids') || '[]');
      ids.push(result.id);
      localStorage.setItem('taskmana_link_ids', JSON.stringify(ids));
      toast('链接已添加', 'success');
      form.remove();
      loadDetailLinks(t.id);
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = '确认'; }
  });
  document.getElementById('il-target').focus();
}

/* ═══════════════════════════════════════════════════════════════════════════
   GRAPH VIEW (Cytoscape.js)
   ═══════════════════════════════════════════════════════════════════════════ */
async function renderGraph() {
  /* destroy previous instance if any */
  if (cyInstance) { cyInstance.destroy(); cyInstance = null; }

  const container = document.getElementById('graph-cy');
  container.innerHTML = '<div class="graph-state"><span class="spinner"></span></div>';

  try {
    /* fetch all tasks & links from API (not localStorage) */
    const [tasks, links] = await Promise.all([
      API.listAllTasks().catch(() => []),
      API.listAllLinks().catch(() => []),
    ]);

    if (tasks.length === 0) {
      container.innerHTML = '<div class="graph-state">📋 暂无任务，点击「＋ 新建任务」开始</div>';
      return;
    }

    /* build Cytoscape elements */
    const elements = [];
    const taskIdSet = new Set(tasks.map(t => t.id));

    for (const t of tasks) {
      // Compute node size: base on connections (we'll update after building edges)
      const tagCount = (t.tags || []).length;
      elements.push({
        data: {
          id: 't' + t.id,
          label: '',  /* no labels by default — Obsidian style */
          fullDesc: t.description || '',
          title: t.title || '',
          label: (t.title || t.description || '#').slice(0, 16),
          status: t.status,
          taskType: t.task_type,
          tags: (t.tags || []).join(', '),
          taskId: t.id,
        },
        classes: `status-${t.status}`,
      });
    }

    for (const lnk of links) {
      if (!taskIdSet.has(lnk.from_task_id) || !taskIdSet.has(lnk.to_task_id)) continue;

      elements.push({
        data: {
          id: 'e' + lnk.id,
          source: 't' + lnk.from_task_id,
          target: 't' + lnk.to_task_id,
          linkType: lnk.link_type,
          note: lnk.note || '',
        },
        classes: `edge-${lnk.link_type}`,
      });
    }

    container.innerHTML = '';

    /* add zoom controls */
    addGraphControls(container);

    /* build legend (wrap in try-catch to not break main render) */
    try { buildGraphLegend(links); } catch (_) {}

    /* guard: Cytoscape loaded? */
    if (typeof cytoscape === 'undefined') {
      container.innerHTML = '<div class="graph-state error">Cytoscape.js 未加载，请检查网络连接</div>';
      return;
    }

    /* create Cytoscape instance — Obsidian style */
    const isDark = document.documentElement.dataset.theme === 'dark';
    const bgColor = isDark ? '#0f1119' : '#f8f9fc';
    const textColor = isDark ? '#e4e6f0' : '#1e2140';

    /* Vibrant kanban colors (same as card gradient bars) */
    const nodeColors = {
      todo:         isDark ? '#7a7f94' : '#c4c8d4',
      in_progress:  isDark ? '#54a0ff' : '#54a0ff',
      blocked:      isDark ? '#e17055' : '#e17055',
      done:         isDark ? '#1dd1a1' : '#1dd1a1',
      paused:       isDark ? '#a29bfe' : '#a29bfe',
      cancelled:    isDark ? '#6a6e82' : '#b2b8c8',
    };

    cyInstance = cytoscape({
      container,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'font-size': '9px',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 4,
            'color': isDark ? '#a0a4bc' : '#9a9eb5',
            'text-wrap': 'wrap',
            'text-max-width': '70px',
            'width': 12,
            'height': 12,
            'border-width': 1.5,
            'border-color': bgColor,
            'background-opacity': 0.85,
            'transition-property': 'width,height,background-opacity,border-width',
            'transition-duration': '0.25s',
            'transition-timing-function': 'ease-out',
          },
        },
        { selector: 'node.status-todo',         style: { 'background-color': nodeColors.todo } },
        { selector: 'node.status-in_progress',  style: { 'background-color': nodeColors.in_progress } },
        { selector: 'node.status-blocked',      style: { 'background-color': nodeColors.blocked } },
        { selector: 'node.status-done',         style: { 'background-color': nodeColors.done, 'background-opacity': 0.65 } },
        { selector: 'node.status-paused',       style: { 'background-color': nodeColors.paused } },
        { selector: 'node.status-cancelled',    style: { 'background-color': nodeColors.cancelled, 'background-opacity': 0.4 } },
        /* Hover: subtle enlarge */
        {
          selector: 'node.hover',
          style: {
            'width': 18,
            'height': 18,
            'border-width': 3,
            'border-color': isDark ? '#feca57' : '#ff9f43',
            'background-opacity': 1,
          },
        },
        /* Connected neighbors on hover */
        {
          selector: 'node.neighbor',
          style: {
            'width': 15,
            'height': 15,
            'background-opacity': 0.9,
            'border-width': 2,
            'border-color': isDark ? '#feca57' : '#ff9f43',
          },
        },
        /* Dim unrelated nodes */
        {
          selector: 'node.dimmed',
          style: {
            'background-opacity': 0.15,
            'border-opacity': 0.15,
          },
        },
        /* Edges: visible, with arrows */
        {
          selector: 'edge',
          style: {
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.5,
            'width': 0.5,
            'opacity': 0.7,
            'line-color': isDark ? '#5a5f7a' : '#b0b5c8',
            'target-arrow-color': isDark ? '#5a5f7a' : '#b0b5c8',
            'transition-property': 'width,opacity',
            'transition-duration': '0.2s',
          },
        },
        /* Edges connected to hovered node */
        {
          selector: 'edge.hover-edge',
          style: {
            'width': 1.2,
            'opacity': 0.6,
          },
        },
        /* Dim unrelated edges */
        {
          selector: 'edge.dimmed',
          style: {
            'opacity': 0.03,
          },
        },
        /* Edge colors by type */
        { selector: 'edge.edge-contains', style: { 'line-color': isDark ? '#7a7f90' : '#a4a8b8', 'target-arrow-color': isDark ? '#7a7f90' : '#a4a8b8' } },
        { selector: 'edge.edge-blocks',   style: { 'line-color': isDark ? '#e17055' : '#e17055', 'target-arrow-color': isDark ? '#e17055' : '#e17055', 'line-style': 'dashed', 'line-dash-pattern': [6, 8] } },
        { selector: 'edge.edge-derives',  style: { 'line-color': isDark ? '#a29bfe' : '#a29bfe', 'target-arrow-color': isDark ? '#a29bfe' : '#a29bfe', 'line-style': 'dashed', 'line-dash-pattern': [2, 12] } },
      ],
      layout: {
        name: 'cose',
        animate: true,
        animationDuration: 1200,
        nodeRepulsion: () => 4000,
        idealEdgeLength: () => 50,
        gravity: 0.4,
        numIter: 3000,
        coolingFactor: 0.95,
        initialEnergyOnIncremental: 0.3,
      },
      wheelSensitivity: 0.2,
      minZoom: 0.2,
      maxZoom: 3,
    });

    /* ── Obsidian-style continuous force simulation ── */
    let simRAF;
    const sim = {
      repulsion: 3000,
      spring: 0.0008,
      springLen: 80,
      gravity: 0.0004,
      damping: 0.85,
      maxSpeed: 0.6,
      padding: 40,
      boundaryForce: 0.08,
    };

    function startSimulation() {
      function tick() {
        if (!cyInstance || cyInstance.destroyed()) { simRAF = null; return; }

        const nodes = cyInstance.nodes();
        const edges = cyInstance.edges();
        const N = nodes.length;
        if (N === 0) { simRAF = requestAnimationFrame(tick); return; }

        /* Circular boundary */
        const extent = cyInstance.extent();
        const cx = (extent.x1 + extent.x2) / 2;
        const cy = (extent.y1 + extent.y2) / 2;
        const radius = Math.min(extent.x2 - extent.x1, extent.y2 - extent.y1) / 2 - sim.padding;
        const forces = {};

        // Init forces
        for (let i = 0; i < N; i++) { forces[nodes[i].id()] = { x: 0, y: 0 }; }

        // Repulsion between all node pairs
        for (let i = 0; i < N; i++) {
          const a = nodes[i];
          const pa = a.position();
          for (let j = i + 1; j < N; j++) {
            const b = nodes[j];
            const pb = b.position();
            const dx = pa.x - pb.x;
            const dy = pa.y - pb.y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.5);
            const f = sim.repulsion / (dist * dist);
            const fx = (dx / dist) * f;
            const fy = (dy / dist) * f;
            forces[a.id()].x += fx;  forces[a.id()].y += fy;
            forces[b.id()].x -= fx;  forces[b.id()].y -= fy;
          }
        }

        // Spring attraction along edges
        for (let k = 0; k < edges.length; k++) {
          const e = edges[k];
          const s = e.source(), t = e.target();
          const ps = s.position(), pt = t.position();
          const dx = pt.x - ps.x, dy = pt.y - ps.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist === 0) continue;
          const displacement = dist - sim.springLen;
          const f = sim.spring * displacement;
          const fx = (dx / dist) * f, fy = (dy / dist) * f;
          forces[s.id()].x += fx;  forces[s.id()].y += fy;
          forces[t.id()].x -= fx;  forces[t.id()].y -= fy;
        }

        // Apply forces with boundary & gravity
        for (let i = 0; i < N; i++) {
          const n = nodes[i];
          const id = n.id();
          const p = n.position();

          // Center gravity (toward circle center)
          forces[id].x += (cx - p.x) * sim.gravity;
          forces[id].y += (cy - p.y) * sim.gravity;

          // Circular boundary: push inward when outside circle
          const dxc = p.x - cx, dyc = p.y - cy;
          const distFromCenter = Math.sqrt(dxc * dxc + dyc * dyc);
          if (distFromCenter > radius && distFromCenter > 0) {
            const overlap = distFromCenter - radius;
            forces[id].x -= (dxc / distFromCenter) * overlap * sim.boundaryForce;
            forces[id].y -= (dyc / distFromCenter) * overlap * sim.boundaryForce;
          }

          // Clamp speed, apply with damping
          const speed = Math.sqrt(forces[id].x ** 2 + forces[id].y ** 2);
          if (speed > sim.maxSpeed) {
            forces[id].x = (forces[id].x / speed) * sim.maxSpeed;
            forces[id].y = (forces[id].y / speed) * sim.maxSpeed;
          }
          n.position({
            x: p.x + forces[id].x * sim.damping,
            y: p.y + forces[id].y * sim.damping,
          });
        }

        simRAF = requestAnimationFrame(tick);
      }
      simRAF = requestAnimationFrame(tick);
    }
    startSimulation();
    cyInstance.on('destroy', () => { if (simRAF) cancelAnimationFrame(simRAF); });

    /* ── Obsidian-style hover: highlight neighbors, dim others ── */
    const floatingLabel = document.createElement('div');
    floatingLabel.className = 'graph-floating-label';
    container.appendChild(floatingLabel);

    cyInstance.on('mouseover', 'node', evt => {
      const node = evt.target;

      // Apply classes
      node.addClass('hover');
      const neighbors = node.neighborhood().nodes();
      neighbors.addClass('neighbor');

      // Dim everything else
      cyInstance.nodes().not(node).not(neighbors).addClass('dimmed');

      // Highlight connected edges
      node.connectedEdges().addClass('hover-edge');
      cyInstance.edges().not(node.connectedEdges()).addClass('dimmed');

      // Show floating label
      const statusLabel = STATUS_LABEL[node.data('status')] || '';
      const typeIcon = TYPE_ICON[node.data('taskType')] || '';
      const displayText = node.data('title') || node.data('fullDesc');
      floatingLabel.innerHTML = `
        <span class="fl-id">#${node.data('taskId')}</span>
        ${typeIcon} ${esc(displayText)}
        <span class="fl-meta">${statusLabel}${node.data('tags') ? ' · ' + esc(node.data('tags')) : ''}</span>
      `;
      floatingLabel.style.display = 'block';
    });

    cyInstance.on('mousemove', 'node', evt => {
      const rect = container.getBoundingClientRect();
      floatingLabel.style.left = (evt.originalEvent.clientX - rect.left + 18) + 'px';
      floatingLabel.style.top = (evt.originalEvent.clientY - rect.top - 10) + 'px';
    });

    cyInstance.on('mouseout', 'node', () => {
      cyInstance.nodes().removeClass('hover neighbor dimmed');
      cyInstance.edges().removeClass('hover-edge dimmed');
      floatingLabel.style.display = 'none';
    });

    /* node click → detail modal */
    cyInstance.on('tap', 'node', evt => {
      const node = evt.target;
      openDetailModal(node.data('taskId'));
    });

  } catch (e) {
    console.error('renderGraph error:', e);
    container.innerHTML = `<div class="graph-state error">加载图失败: ${esc(e.message || String(e))}</div>`;
  }
}

function addGraphControls(container) {
  const ctrls = document.createElement('div');
  ctrls.className = 'graph-controls';
  ctrls.innerHTML = `
    <button class="graph-ctrl-btn" title="放大" data-zoom="in">＋</button>
    <button class="graph-ctrl-btn" title="缩小" data-zoom="out">−</button>
    <button class="graph-ctrl-btn" title="适应画面" data-zoom="fit">⊡</button>
  `;
  ctrls.querySelector('[data-zoom="in"]').addEventListener('click', () => {
    if (cyInstance) cyInstance.zoom(cyInstance.zoom() * 1.3);
  });
  ctrls.querySelector('[data-zoom="out"]').addEventListener('click', () => {
    if (cyInstance) cyInstance.zoom(cyInstance.zoom() * 0.7);
  });
  ctrls.querySelector('[data-zoom="fit"]').addEventListener('click', () => {
    if (cyInstance) cyInstance.fit(undefined, 40);
  });
  container.appendChild(ctrls);
}

function buildGraphLegend(links) {
  const container = document.getElementById('graph-legend');
  const statuses = [
    { key: 'todo', label: '未开始' },
    { key: 'in_progress', label: '进行中' },
    { key: 'blocked', label: '阻塞' },
    { key: 'done', label: '已完成' },
    { key: 'paused', label: '已暂停' },
    { key: 'cancelled', label: '已取消' },
  ];
  const linkTypes = [
    { key: 'contains', label: '包含', cls: 'legend-line-contains' },
    { key: 'blocks', label: '阻塞', cls: 'legend-line-blocks' },
    { key: 'derives', label: '派生', cls: 'legend-line-derives' },
  ];

  let html = '<div class="legend-toggle" id="legend-toggle">📊 图例 ▾</div>';
  html += '<div class="legend-body">';
  for (const s of statuses) {
    html += `<div class="legend-item"><span class="legend-dot legend-dot-${s.key}"></span>${s.label}</div>`;
  }
  const hasTypes = new Set(links.map(l => l.link_type));
  for (const lt of linkTypes) {
    if (hasTypes.has(lt.key) || links.length === 0) {
      html += `<div class="legend-item"><span class="legend-line ${lt.cls}"></span>${lt.label}</div>`;
    }
  }
  if (links.length === 0) {
    // show all link types in legend when no links exist
  }
  html += '</div>';
  container.innerHTML = html;
  container.classList.add('collapsed');
  document.getElementById('legend-toggle').addEventListener('click', () => {
    container.classList.toggle('collapsed');
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   MARKDOWN EDITOR (Vditor)
   ═══════════════════════════════════════════════════════════════════════════ */
let _mdEditorInstance = null;
let _mdTaskId = null;
let _mdField = null;
let _mdOriginalContent = null;

const MD_FIELD_LABELS = { plan: '📋 计划', log: '📝 日志', review: '🔍 复盘' };

async function openMdEditorForTask(taskId, field) {
  const modal = document.getElementById('modal-md');
  const container = document.getElementById('md-editor-container');
  const titleEl = document.getElementById('modal-md-title');

  titleEl.textContent = `加载中…`;
  container.innerHTML = '<div class="md-editor-loading"><span class="spinner"></span> 加载编辑器…</div>';
  modal.showModal();

  try {
    const t = await API.readTask(taskId);
    const content = t[field] || '';
    _mdTaskId = taskId;
    _mdField = field;
    _mdOriginalContent = content;
    titleEl.textContent = `任务 #${taskId} — ${MD_FIELD_LABELS[field] || field}`;

    /* Destroy previous instance if any */
    if (_mdEditorInstance) {
      try { _mdEditorInstance.destroy(); } catch (_) {}
      _mdEditorInstance = null;
    }

    container.innerHTML = '';

    _mdEditorInstance = new Vditor('md-editor-container', {
      mode: 'wysiwyg',
      height: '100%',
      minHeight: 0,
      value: content || '',
      placeholder: '请输入内容…',
      cache: { enable: false },
      counter: { enable: true, type: 'text' },
      upload: {
        url: '/api/images',
        fieldName: 'file',
        format: (files, responseText) => {
          const res = JSON.parse(responseText);
          const data = { msg: '', code: 0, data: { errFiles: [], succMap: {} } };
          data.data.succMap[files[0].name] = res.url;
          return JSON.stringify(data);
        },
      },
      toolbarConfig: { pin: true },
    });
  } catch (err) {
    container.innerHTML = `<div class="md-editor-loading" style="color:var(--danger)">编辑器加载失败: ${esc(err.message || String(err))}</div>`;
    console.error('Vditor init error:', err);
  }
}

async function _saveMdEditor() {
  if (!_mdEditorInstance || !_mdTaskId || !_mdField) return;
  const btn = document.getElementById('btn-md-save');
  btn.disabled = true; btn.textContent = '保存中…';

  try {
    const markdown = _mdEditorInstance.getValue();
    const newContent = markdown.trim() || null;
    const orig = (_mdOriginalContent || '').trim() || null;
    if (newContent === orig) {
      document.getElementById('modal-md').close();
      toast('内容未变更', 'success');
      return;
    }
    await API.updateTask(_mdTaskId, { [_mdField]: newContent });
    document.getElementById('modal-md').close();
    toast(`${MD_FIELD_LABELS[_mdField]} 已保存`, 'success');
    refreshTaskList();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '💾 保存';
  }
}

function _closeMdEditor() {
  if (_mdEditorInstance) {
    try { _mdEditorInstance.destroy(); } catch (_) {}
    _mdEditorInstance = null;
  }
  _mdTaskId = null;
  _mdField = null;
  _mdOriginalContent = null;
  const container = document.getElementById('md-editor-container');
  container.innerHTML = '<div class="md-editor-loading"><span class="spinner"></span> 加载编辑器…</div>';
}

/* ═══════════════════════════════════════════════════════════════════════════
   UTILITY
   ═══════════════════════════════════════════════════════════════════════════ */
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function kv(label, value) {
  return `<div class="dg-label">${label}</div><div class="dg-value">${value}</div>`;
}

function parseCsv(raw) {
  if (!raw) return [];
  return raw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
}

function arraysEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Compare form data against the original task and return only changed fields.
 * - scalar strings / numbers: strict equality
 * - arrays (tags, people): element-by-element
 * - deadline: compare date portion (YYYY-MM-DDTHH:MM) because the form input
 *   is datetime-local; original may carry seconds / timezone.
 */
function diffForPatch(formData, original) {
  const patch = {};
  for (const [k, v] of Object.entries(formData)) {
    if (v === null || v === undefined) continue;
    const orig = original[k];

    if (k === 'deadline') {
      // compare first 16 chars — the precision of the <input type="datetime-local">
      const newDate = v ? v.slice(0, 16) : null;
      const oldDate = orig ? orig.slice(0, 16) : null;
      if (newDate !== oldDate) patch[k] = v;
    } else if (Array.isArray(v)) {
      if (!arraysEqual(v, orig || [])) patch[k] = v;
    } else {
      if (v !== (orig ?? null)) patch[k] = v;
    }
  }
  return patch;
}

function toast(message, type) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type || ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3500);
}
