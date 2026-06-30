// GT App - Client Logic (Dynamic Layout with Dynamic Users & Collapse)

// State
let users = [];
let tasksData = {};
let collapsedColumns = {}; // userName (lowercase) -> boolean (true if collapsed, false if expanded)
let currentFilter = 'all';
let searchQuery = '';
let debounceTimers = {};
let editingUser = null;
let currentSort = 'default';
let currentView = 'tasks';

// On Load
document.addEventListener('DOMContentLoaded', () => {
    initDate();
    initApp();
    setupEventListeners();
    initPolling();
});

// Display Today's Date in Foreground
function initDate() {
    const daysWeek = [
        'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
        'quinta-feira', 'sexta-feira', 'sábado'
    ];
    const months = [
        'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
        'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
    ];
    
    const now = new Date();
    const dayName = daysWeek[now.getDay()];
    const day = String(now.getDate()).padStart(2, '0');
    const month = months[now.getMonth()];
    const year = now.getFullYear();
    
    document.getElementById('current-day-name').textContent = dayName;
    document.getElementById('current-date-full').textContent = `${day} de ${month} de ${year}`;
}

// Initialise App
async function initApp() {
    await fetchUsers();
}

// Setup Event Listeners
function setupEventListeners() {
    // Search
    document.getElementById('search-input').addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderAllTasks();
    });

    // Filters
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderAllTasks();
        });
    });

    // Modals Control
    document.getElementById('btn-open-register-user').addEventListener('click', () => {
        openModal('modal-register-user');
        renderUsersMiniList();
    });

    // User Form Submit
    document.getElementById('form-register-user').addEventListener('submit', handleRegisterUser);

    // Task Form Submit
    document.getElementById('form-add-task').addEventListener('submit', handleAddTask);

    // Sorting
    document.getElementById('sort-select').addEventListener('change', (e) => {
        currentSort = e.target.value;
        renderAllTasks();
    });

    // Mobile Link Popover Toggle
    const mobileBtn = document.getElementById('btn-mobile-link');
    const mobilePopover = document.getElementById('mobile-popover');
    if (mobileBtn && mobilePopover) {
        mobileBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            const isHidden = mobilePopover.classList.contains('hidden');
            if (isHidden) {
                mobilePopover.classList.remove('hidden');
                try {
                    const res = await fetch('/api/info');
                    if (res.ok) {
                        const data = await res.json();
                        const url = data.tunnelUrl || data.localUrl;
                        document.getElementById('mobile-url-input').value = url;
                        
                        const qrContainer = document.getElementById('qr-container');
                        qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(url)}" alt="QR Code">`;
                    }
                } catch (err) {
                    console.error('Erro ao buscar info celular:', err);
                }
            } else {
                mobilePopover.classList.add('hidden');
            }
        });
        
        mobilePopover.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    // Global Click Listener to close popovers
    document.addEventListener('click', () => {
        if (mobilePopover) mobilePopover.classList.add('hidden');
    });

    // View Tab buttons switching
    const tabBtns = document.querySelectorAll('.view-tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            switchView(btn.dataset.view);
        });
    });
}

// Fetch Users list
async function fetchUsers() {
    try {
        const res = await fetch('/api/users');
        if (!res.ok) throw new Error('Não foi possível carregar a lista de responsáveis.');
        users = await res.json();
        
        // Initialize collapsed state (all columns are collapsed by default!)
        users.forEach(u => {
            const lowerName = u.name.toLowerCase();
            if (collapsedColumns[lowerName] === undefined) {
                collapsedColumns[lowerName] = true; // start collapsed
            }
        });

        // Re-create columns grid skeleton
        renderColumnsSkeleton();
        
        // Fetch Tasks
        await fetchTasks();
    } catch (err) {
        console.error(err);
        showToast('Erro ao carregar responsáveis: ' + err.message, true);
    }
}

// Render dynamic column elements based on users list
function renderColumnsSkeleton() {
    const grid = document.getElementById('users-columns-grid');
    grid.innerHTML = '';

    if (users.length === 0) {
        grid.innerHTML = `<div class="loader-inner" style="grid-column: 1 / -1; color: var(--text-muted);">Nenhum usuário cadastrado.</div>`;
        return;
    }

    users.forEach(u => {
        const lowerName = u.name.toLowerCase();
        const isCollapsed = collapsedColumns[lowerName];
        
        const col = document.createElement('section');
        col.className = `list-column glass-panel ${isCollapsed ? 'collapsed' : ''}`;
        col.id = `column-${lowerName}`;
        
        // Handle dynamic colors
        if (lowerName === 'ketlyn' || lowerName === 'ariel') {
            col.setAttribute('data-user', lowerName);
        } else {
            col.setAttribute('data-user-dynamic', 'true');
        }

        col.innerHTML = `
            <div class="column-header">
                <div class="column-header-clickable" onclick="toggleColumnCollapse('${lowerName}')">
                    <i class="fa-solid fa-chevron-down toggle-arrow"></i>
                    <i class="fa-solid fa-circle-user"></i>
                    <h2>${u.name}</h2>
                </div>
                <div class="column-header-actions">
                    <button class="btn-add-task-inline" onclick="openAddTaskModal('${lowerName}', '${u.name}')" title="Adicionar pendência para ${u.name}">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                    <span class="badge" id="count-${lowerName}">0</span>
                </div>
            </div>
            <div class="cards-container ${isCollapsed ? 'collapsed' : ''}" id="container-${lowerName}">
                <div class="loader-inner"><i class="fa-solid fa-circle-notch fa-spin"></i></div>
            </div>
        `;

        grid.appendChild(col);
    });
}

// Fetch Tasks from API
async function fetchTasks() {
    try {
        const res = await fetch('/api/tasks');
        if (!res.ok) throw new Error('Não foi possível obter as pendências.');
        
        tasksData = await res.json();
        renderAllTasks();
        renderDashboard();
    } catch (err) {
        console.error(err);
        showToast('Erro ao carregar tarefas: ' + err.message, true);
    }
}

// Toggle collapse state of a column
function toggleColumnCollapse(lowerName) {
    const isCollapsed = !collapsedColumns[lowerName];
    collapsedColumns[lowerName] = isCollapsed;

    const col = document.getElementById(`column-${lowerName}`);
    const container = document.getElementById(`container-${lowerName}`);

    if (isCollapsed) {
        col.classList.add('collapsed');
        container.classList.add('collapsed');
    } else {
        col.classList.remove('collapsed');
        container.classList.remove('collapsed');
    }
}

// Filter & Search Logic
function filterAndSearch(list) {
    if (!list) return [];
    return list.filter(item => {
        // Status Filter
        if (currentFilter === 'pending' && item.completed) return false;
        if (currentFilter === 'completed' && !item.completed) return false;
        
        // Search Filter
        if (searchQuery) {
            const matchTask = item.task && item.task.toLowerCase().includes(searchQuery);
            const matchObs = item.observation && item.observation.toLowerCase().includes(searchQuery);
            return matchTask || matchObs;
        }
        
        return true;
    });
}

// Render All Tasks lists
function renderAllTasks() {
    users.forEach(u => {
        const lowerName = u.name.toLowerCase();
        const list = tasksData[lowerName] || [];
        renderColumnTasks(lowerName, list);
    });
}

// Render Specific User Tasks
function renderColumnTasks(lowerName, list) {
    const container = document.getElementById(`container-${lowerName}`);
    const countBadge = document.getElementById(`count-${lowerName}`);
    
    if (!container || !countBadge) return;

    const filteredList = filterAndSearch(list);

    // Apply Sorting
    if (currentSort === 'classification') {
        const weights = { 'urgente': 1, 'semanal': 2, 'mensal': 3, '': 4 };
        filteredList.sort((a, b) => {
            const wa = weights[a.classification || ''] || 4;
            const wb = weights[b.classification || ''] || 4;
            if (wa !== wb) return wa - wb;
            return a.row - b.row;
        });
    }
    
    // Update Badge (show pending count)
    const pendingCount = list.filter(item => !item.completed).length;
    countBadge.textContent = pendingCount;
    
    container.innerHTML = '';
    
    if (filteredList.length === 0) {
        container.innerHTML = `<div class="loader-inner" style="font-size:0.9rem; color:var(--text-muted); padding: 24px 0;">Nenhuma pendência encontrada.</div>`;
        return;
    }
    
    filteredList.forEach(item => {
        const card = document.createElement('div');
        card.className = `task-card ${item.completed ? 'completed' : ''}`;
        card.dataset.row = item.row;
        
        const hasComment = !!item.observation;
        
        const obsId = `${lowerName}-obs-${item.row}`;
        const statusId = `${lowerName}-status-${item.row}`;
        const containerId = `${lowerName}-obs-container-${item.row}`;
        const buttonId = `${lowerName}-btn-comment-${item.row}`;

        const classificationBadge = item.classification 
            ? `<span class="class-badge badge-${item.classification}">${item.classification.toUpperCase()}</span>` 
            : '';
        
        const cardContent = `
            <div class="card-top">
                <label class="checkbox-container">
                    <input type="checkbox" ${item.completed ? 'checked' : ''} onchange="toggleTask('${lowerName}', ${item.row}, this.checked)">
                    <span class="checkmark"></span>
                </label>
                <div class="task-content">
                    <div class="task-text">${classificationBadge}${item.task}</div>
                </div>
                <div class="card-actions">
                    <div class="classification-dots">
                        <button class="dot-btn urgent ${item.classification === 'urgente' ? 'active' : ''}" onclick="changeClassification('${lowerName}', ${item.row}, 'urgente')" title="Urgente"></button>
                        <button class="dot-btn weekly ${item.classification === 'semanal' ? 'active' : ''}" onclick="changeClassification('${lowerName}', ${item.row}, 'semanal')" title="Semanal"></button>
                        <button class="dot-btn monthly ${item.classification === 'mensal' ? 'active' : ''}" onclick="changeClassification('${lowerName}', ${item.row}, 'mensal')" title="Mensal"></button>
                        <button class="dot-btn none ${!item.classification ? 'active' : ''}" onclick="changeClassification('${lowerName}', ${item.row}, 'none')" title="Limpar Classificação"></button>
                    </div>
                    <button id="${buttonId}" class="btn-comment ${hasComment ? 'has-comment' : ''}" onclick="toggleComment('${lowerName}', ${item.row})" title="Observações">
                        <i class="${hasComment ? 'fa-solid fa-comment' : 'fa-regular fa-comment'}"></i>
                    </button>
                </div>
            </div>
            
            <div id="${containerId}" class="observation-container collapsed">
                <div class="observation-box">
                    <textarea id="${obsId}" class="observation-input" placeholder="Adicionar observações..." rows="2" oninput="saveObservationDebounced('${lowerName}', ${item.row}, this.value, '${lowerName}', '${statusId}', '${buttonId}')">${item.observation || ''}</textarea>
                    <div id="${statusId}" class="observation-status">
                        <i class="fa-solid fa-spinner fa-spin icon-saving"></i>
                        <i class="fa-solid fa-check icon-saved"></i>
                    </div>
                </div>
            </div>
        `;
        
        card.innerHTML = cardContent;
        container.appendChild(card);
    });
}

// Toggle Observation Container visibility
function toggleComment(lowerName, row) {
    const container = document.getElementById(`${lowerName}-obs-container-${row}`);
    const textarea = document.getElementById(`${lowerName}-obs-${row}`);
    
    if (container.classList.contains('collapsed')) {
        // Open
        container.classList.remove('collapsed');
        setTimeout(() => textarea.focus(), 100);
    } else {
        // Close
        container.classList.add('collapsed');
    }
}

// Toggle Task Complete (Optimistic Update)
async function toggleTask(person, row, checked) {
    const item = tasksData[person].find(i => i.row === row);
    if (item) {
        item.completed = checked;
        
        // Find card in DOM and add class instantly
        const cards = document.querySelectorAll(`#container-${person} .task-card`);
        for (let card of cards) {
            if (Number(card.dataset.row) === row) {
                if (checked) card.classList.add('completed');
                else card.classList.remove('completed');
                break;
            }
        }
        
        // Update badge
        const pendingCount = tasksData[person].filter(i => !i.completed).length;
        document.getElementById(`count-${person}`).textContent = pendingCount;
    }
    
    try {
        const res = await fetch('/api/tasks/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                row,
                completed: checked,
                person
            })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao sincronizar.');
        
        showToast('Planilha atualizada!');
    } catch (err) {
        console.error(err);
        showToast('Erro ao atualizar status: ' + err.message, true);
        // Rollback
        if (item) {
            item.completed = !checked;
            renderColumnTasks(person, tasksData[person]);
        }
    }
}

// Debounced Observation Save
function saveObservationDebounced(type, row, text, person, statusId, buttonId) {
    const statusEl = document.getElementById(statusId);
    const buttonEl = document.getElementById(buttonId);
    const iconEl = buttonEl.querySelector('i');
    
    statusEl.className = 'observation-status saving'; // show spinner
    
    const key = `${type}-${row}`;
    if (debounceTimers[key]) {
        clearTimeout(debounceTimers[key]);
    }
    
    debounceTimers[key] = setTimeout(async () => {
        try {
            const res = await fetch('/api/tasks/observation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    row,
                    observation: text,
                    person
                })
            });
            
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao salvar.');
            
            // Save state locally
            const item = tasksData[person].find(i => i.row === row);
            if (item) item.observation = text;
            
            // Update button UI dynamically
            if (text.trim()) {
                buttonEl.classList.add('has-comment');
                iconEl.className = 'fa-solid fa-comment';
            } else {
                buttonEl.classList.remove('has-comment');
                iconEl.className = 'fa-regular fa-comment';
            }
            
            statusEl.className = 'observation-status saved';
        } catch (err) {
            console.error(err);
            showToast('Erro ao salvar observação: ' + err.message, true);
            statusEl.className = 'observation-status'; // hide
        }
    }, 1000);
}

// Handle Register User Submit
// Handle Register/Edit User Submit
async function handleRegisterUser(e) {
    e.preventDefault();
    const nameInput = document.getElementById('reg-name');
    const emailInput = document.getElementById('reg-email');
    
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    
    try {
        let res, data;
        if (editingUser) {
            // Update mode
            res = await fetch('/api/users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ originalName: editingUser, name, email })
            });
            data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao atualizar usuário.');
            
            showToast(`Usuário ${name} atualizado com sucesso!`);
            cancelEditUser(); // reset form to registration mode
        } else {
            // Register mode
            res = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email })
            });
            data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao registrar usuário.');
            
            showToast(`Usuário ${name} cadastrado com sucesso!`);
            nameInput.value = '';
            emailInput.value = '';
        }
        
        closeModal('modal-register-user');
        
        // Reload configuration and grid
        await fetchUsers();
    } catch (err) {
        console.error(err);
        showToast(err.message, true);
    }
}

// Handle Add Task Submit
async function handleAddTask(e) {
    e.preventDefault();
    const ownerId = document.getElementById('add-task-owner-id').value;
    const taskInput = document.getElementById('task-text');
    const obsInput = document.getElementById('task-obs');
    const classificationSelect = document.getElementById('task-classification');
    
    const task = taskInput.value.trim();
    const observation = obsInput.value.trim();
    const classification = classificationSelect ? classificationSelect.value : '';
    
    try {
        const res = await fetch('/api/tasks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                person: ownerId,
                task,
                observation,
                classification
            })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao adicionar pendência.');
        
        showToast('Pendência adicionada com sucesso!');
        taskInput.value = '';
        obsInput.value = '';
        if (classificationSelect) classificationSelect.value = '';
        closeModal('modal-add-task');
        
        // Expand the column automatically so the user sees the new task
        collapsedColumns[ownerId] = false;
        
        // Update column skeletons and fetch updated data
        renderColumnsSkeleton();
        await fetchTasks();
    } catch (err) {
        console.error(err);
        showToast(err.message, true);
    }
}

// Open Task creation Modal
function openAddTaskModal(lowerName, cleanName) {
    document.getElementById('add-task-owner-id').value = lowerName;
    document.getElementById('add-task-owner-name').textContent = cleanName;
    openModal('modal-add-task');
    
    // Focus first input
    setTimeout(() => document.getElementById('task-text').focus(), 100);
}

// Render registered users inside User Modal list
function renderUsersMiniList() {
    const list = document.getElementById('users-mini-list');
    list.innerHTML = '';
    
    users.forEach(u => {
        const item = document.createElement('div');
        item.className = 'user-mini-item';
        item.innerHTML = `
            <div class="user-mini-item-info">
                <span class="user-mini-item-name">${u.name}</span>
                <span class="user-mini-item-email">${u.email}</span>
            </div>
            <div class="user-mini-item-right">
                <span class="user-mini-item-cols" title="Colunas de Tarefas / Observações no Sheets">${u.taskCol} / ${u.obsCol}</span>
                <button type="button" class="btn-edit-user" onclick="startEditUser('${u.name}')" title="Editar Usuário">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
            </div>
        `;
        list.appendChild(item);
    });
}

// Start Edit Mode
function startEditUser(userName) {
    const user = users.find(u => u.name.toLowerCase() === userName.toLowerCase());
    if (!user) return;
    
    editingUser = user.name;
    
    // Set inputs
    document.getElementById('reg-name').value = user.name;
    document.getElementById('reg-email').value = user.email;
    
    // Change Title & Submit Button
    document.getElementById('user-modal-title').innerHTML = `<i class="fa-solid fa-user-pen"></i> Editar Usuário: ${user.name}`;
    document.getElementById('btn-submit-user').textContent = 'Salvar Alterações';
    
    // Show Cancel Edit Button
    document.getElementById('btn-cancel-edit-user').classList.remove('hidden');
    // Hide Close Modal Button
    document.getElementById('btn-cancel-user-modal').classList.add('hidden');
}

// Cancel Edit Mode
function cancelEditUser() {
    editingUser = null;
    
    // Reset inputs
    document.getElementById('reg-name').value = '';
    document.getElementById('reg-email').value = '';
    
    // Reset Title & Submit Button
    document.getElementById('user-modal-title').innerHTML = `<i class="fa-solid fa-user-plus"></i> Cadastrar Novo Usuário`;
    document.getElementById('btn-submit-user').textContent = 'Cadastrar';
    
    // Hide Cancel Edit Button
    document.getElementById('btn-cancel-edit-user').classList.add('hidden');
    // Show Close Modal Button
    document.getElementById('btn-cancel-user-modal').classList.remove('hidden');
}

// Modal control helpers
function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

// Toast Alert System
function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    
    toastMessage.textContent = message;
    toast.style.borderColor = isError ? '#f44336' : 'rgba(var(--color-primary-rgb), 0.3)';
    
    const icon = isError ? '<i class="fa-solid fa-circle-exclamation" style="color:#f44336"></i> ' : '<i class="fa-solid fa-circle-check" style="color:#4caf50"></i> ';
    toastMessage.innerHTML = icon + message;
    
    toast.classList.remove('hidden');
    
    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    window.toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// Change task classification
async function changeClassification(person, row, newClassification) {
    try {
        const userList = tasksData[person.toLowerCase()];
        if (!userList) return;
        
        const taskItem = userList.find(t => t.row === row);
        if (!taskItem) return;

        // Update locally first for smooth transition
        taskItem.classification = newClassification === 'none' ? '' : newClassification;
        renderAllTasks();

        const res = await fetch('/api/tasks/classify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                row,
                person,
                classification: newClassification
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao atualizar classificação.');
        
        // Update local task text to match Sheets (guarantees sheet priority!)
        if (data.taskText) {
            const finalTaskText = data.taskText;
            const upperText = finalTaskText.toUpperCase();
            let cleanText = finalTaskText;
            if (upperText.startsWith('[URGENTE]')) {
              cleanText = finalTaskText.substring(9).trim();
            } else if (upperText.startsWith('[SEMANAL]')) {
              cleanText = finalTaskText.substring(9).trim();
            } else if (upperText.startsWith('[MENSAL]')) {
              cleanText = finalTaskText.substring(8).trim();
            }
            taskItem.task = cleanText;
        }

        taskItem.classification = newClassification === 'none' ? '' : newClassification;
        renderAllTasks();
        showToast('Classificação atualizada com sucesso!');
        
    } catch (err) {
        console.error(err);
        showToast(err.message, true);
        
        // Revert on error
        await fetchTasks();
    }
}

// Setup Polling to keep app synced with spreadsheet changes
function initPolling() {
    // Poll every 10 seconds
    setInterval(async () => {
        // Skip polling if the user has an open modal
        const activeBackdrops = document.querySelectorAll('.modal-backdrop:not(.hidden)');
        if (activeBackdrops.length > 0) return;

        // Skip polling if the user is actively typing in a textarea or input
        const active = document.activeElement;
        if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
            return;
        }

        try {
            const res = await fetch('/api/tasks');
            if (res.ok) {
                tasksData = await res.json();
                renderAllTasks();
                renderDashboard();
            }
        } catch (err) {
            console.error('Erro no polling:', err);
        }
    }, 10000);
}

// Switch between dashboard and tasks board views
function switchView(viewName) {
    currentView = viewName;
    const tasksView = document.getElementById('tasks-view');
    const dashboardView = document.getElementById('dashboard-view');
    
    if (viewName === 'tasks') {
        tasksView.classList.remove('hidden');
        dashboardView.classList.add('hidden');
        renderAllTasks();
    } else {
        tasksView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        renderDashboard();
    }
}

// Render dynamic dashboard overview
function renderDashboard() {
    const statsSummary = document.getElementById('dashboard-stats-summary');
    const usersGrid = document.getElementById('dashboard-users-grid');
    if (!statsSummary || !usersGrid) return;

    // Calculate metrics
    let totalPending = 0;
    let totalUrgent = 0;
    let userStats = [];

    users.forEach(u => {
        const lowerName = u.name.toLowerCase();
        const userList = tasksData[lowerName] || [];
        
        // Count open tasks (item.completed === false)
        const openTasks = userList.filter(t => !t.completed);
        const count = openTasks.length;
        totalPending += count;

        let urgentCount = 0;
        let weeklyCount = 0;
        let monthlyCount = 0;
        let noneCount = 0;

        openTasks.forEach(t => {
            if (t.classification === 'urgente') urgentCount++;
            else if (t.classification === 'semanal') weeklyCount++;
            else if (t.classification === 'mensal') monthlyCount++;
            else noneCount++;
        });

        totalUrgent += urgentCount;

        userStats.push({
            user: u,
            count,
            urgentCount,
            weeklyCount,
            monthlyCount,
            noneCount
        });
    });

    // Find user with most pending tasks
    let mostLoadedUser = 'Nenhum';
    let maxPending = -1;
    userStats.forEach(stat => {
        if (stat.count > maxPending && stat.count > 0) {
            maxPending = stat.count;
            mostLoadedUser = `${stat.user.name} (${stat.count})`;
        }
    });
    if (maxPending === -1) {
        mostLoadedUser = 'Nenhum';
    }

    // Render global stats cards
    statsSummary.innerHTML = `
        <div class="stat-card glass-panel">
            <div class="stat-card-icon total-pending">
                <i class="fa-solid fa-list-check"></i>
            </div>
            <div class="stat-card-info">
                <span class="stat-card-label">Total Pendentes</span>
                <span class="stat-card-value">${totalPending}</span>
            </div>
        </div>
        <div class="stat-card glass-panel">
            <div class="stat-card-icon total-urgent">
                <i class="fa-solid fa-fire-flame-curved"></i>
            </div>
            <div class="stat-card-info">
                <span class="stat-card-label">Itens Urgentes</span>
                <span class="stat-card-value">${totalUrgent}</span>
            </div>
        </div>
        <div class="stat-card glass-panel">
            <div class="stat-card-icon most-loaded">
                <i class="fa-solid fa-triangle-exclamation"></i>
            </div>
            <div class="stat-card-info">
                <span class="stat-card-label">Mais Carregado</span>
                <span class="stat-card-value" style="font-size: 1.1rem; font-weight: 600;">${mostLoadedUser}</span>
            </div>
        </div>
    `;

    // Render user grid cards
    usersGrid.innerHTML = '';
    if (userStats.length === 0) {
        usersGrid.innerHTML = `<div class="loader-inner" style="grid-column: 1 / -1; color: var(--text-muted);">Nenhum usuário para resumir.</div>`;
        return;
    }

    userStats.forEach(stat => {
        const lowerName = stat.user.name.toLowerCase();
        
        // Progress segments percentages
        const total = stat.count || 1; // avoid division by zero
        const urgentPct = stat.count ? (stat.urgentCount / total) * 100 : 0;
        const weeklyPct = stat.count ? (stat.weeklyCount / total) * 100 : 0;
        const monthlyPct = stat.count ? (stat.monthlyCount / total) * 100 : 0;
        const nonePct = stat.count ? (stat.noneCount / total) * 100 : 0;

        const card = document.createElement('div');
        card.className = 'user-summary-card glass-panel';
        
        if (lowerName === 'ketlyn' || lowerName === 'ariel') {
            card.setAttribute('data-user', lowerName);
        } else {
            card.setAttribute('data-user-dynamic', 'true');
        }

        // Set click behavior to jump to the user's column
        card.addEventListener('click', () => {
            // 1. Switch back to tasks view
            document.querySelectorAll('.view-tab-btn').forEach(btn => {
                if (btn.dataset.view === 'tasks') btn.classList.add('active');
                else btn.classList.remove('active');
            });
            switchView('tasks');
            
            // 2. Expand column
            collapsedColumns[lowerName] = false;
            const col = document.getElementById(`column-${lowerName}`);
            const container = document.getElementById(`container-${lowerName}`);
            if (col && container) {
                col.classList.remove('collapsed');
                container.classList.remove('collapsed');
                
                // 3. Scroll to it
                col.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Add a brief glow animation effect
                col.classList.add('glow-highlight');
                setTimeout(() => col.classList.remove('glow-highlight'), 2000);
            }
        });

        card.innerHTML = `
            <div class="user-card-header">
                <div class="user-card-avatar">
                    <i class="fa-solid fa-circle-user"></i>
                </div>
                <div class="user-card-meta">
                    <span class="user-card-name">${stat.user.name}</span>
                    <span class="user-card-email">${stat.user.email || 'Sem e-mail'}</span>
                </div>
            </div>
            
            <div class="user-card-counter">
                <span class="user-card-counter-num">${stat.count}</span>
                <span class="user-card-counter-label">pendências em aberto</span>
            </div>

            <div class="user-card-progress-container">
                <div class="user-card-progress-bar">
                    <div class="progress-segment urgent" style="width: ${urgentPct}%" title="Urgente: ${stat.urgentCount}"></div>
                    <div class="progress-segment weekly" style="width: ${weeklyPct}%" title="Semanal: ${stat.weeklyCount}"></div>
                    <div class="progress-segment monthly" style="width: ${monthlyPct}%" title="Mensal: ${stat.monthlyCount}"></div>
                    <div class="progress-segment none" style="width: ${nonePct}%" title="Sem Prioridade: ${stat.noneCount}"></div>
                </div>
            </div>

            <div class="user-card-breakdown">
                <div class="breakdown-item">
                    <div class="breakdown-label">
                        <span class="breakdown-dot urgent"></span>
                        <span>Urgentes</span>
                    </div>
                    <span class="breakdown-count">${stat.urgentCount}</span>
                </div>
                <div class="breakdown-item">
                    <div class="breakdown-label">
                        <span class="breakdown-dot weekly"></span>
                        <span>Semanais</span>
                    </div>
                    <span class="breakdown-count">${stat.weeklyCount}</span>
                </div>
                <div class="breakdown-item">
                    <div class="breakdown-label">
                        <span class="breakdown-dot monthly"></span>
                        <span>Mensais</span>
                    </div>
                    <span class="breakdown-count">${stat.monthlyCount}</span>
                </div>
                <div class="breakdown-item">
                    <div class="breakdown-label">
                        <span class="breakdown-dot none"></span>
                        <span>Comuns</span>
                    </div>
                    <span class="breakdown-count">${stat.noneCount}</span>
                </div>
            </div>
        `;

        usersGrid.appendChild(card);
    });
}
