// GT App - Client Logic (Dynamic Layout with Dynamic Users & Collapse)

// State
let users = [];
let tasksData = {};
let collapsedColumns = {}; // userName (lowercase) -> boolean (true if collapsed, false if expanded)
let currentFilter = 'all';
let searchQuery = '';
let debounceTimers = {};
let editingUser = null;
let currentView = 'tasks';

const USER_COLORS = [
    '#b85eff', // Purple (Ketlyn)
    '#ff9100', // Orange (Ariel)
    '#00e5ff', // Cyan
    '#00ff88', // Green
    '#ff455b', // Red/Rose
    '#ffd740', // Amber
    '#448aff', // Blue
    '#ff79c6', // Pink
    '#f1fa8c', // Light Yellow
    '#50fa7b'  // Mint Green
];

// Helper to auto-resize textareas based on content length
function autoResizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

// On Load
document.addEventListener('DOMContentLoaded', () => {
    initDate();
    initApp();
    setupEventListeners();
    initPolling();
});

// Date helpers for task scheduling
function getTodayLocalDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function isOverdue(dateStr, completed) {
    if (completed) return false;
    const nowObj = new Date();
    const year = nowObj.getFullYear();
    const month = String(nowObj.getMonth() + 1).padStart(2, '0');
    const day = String(nowObj.getDate()).padStart(2, '0');
    const hours = String(nowObj.getHours()).padStart(2, '0');
    const minutes = String(nowObj.getMinutes()).padStart(2, '0');
    
    const localNowStr = `${year}-${month}-${day}T${hours}:${minutes}`;
    
    if (!dateStr.includes('T')) {
        const todayStr = `${year}-${month}-${day}`;
        return dateStr < todayStr;
    }
    return dateStr < localNowStr;
}

function formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('T');
    const dateParts = parts[0].split('-');
    if (dateParts.length !== 3) return dateStr;
    const formattedDate = `${dateParts[2]}/${dateParts[1]}`;
    if (parts[1]) {
        return `${formattedDate} às ${parts[1]}`;
    }
    return formattedDate;
}

function formatFullDateDisplay(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('T');
    const dateParts = parts[0].split('-');
    if (dateParts.length !== 3) return dateStr;
    const dateObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
    const daysWeek = [
        'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
        'Quinta-feira', 'Sexta-feira', 'Sábado'
    ];
    const dayName = daysWeek[dateObj.getDay()];
    const formattedDate = `${dayName}, ${dateParts[2]}/${dateParts[1]}`;
    if (parts[1]) {
        return `${formattedDate} às ${parts[1]}`;
    }
    return formattedDate;
}

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
    const tabBtns = document.querySelectorAll('.view-tab-btn[data-view]');
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

    users.forEach((u, index) => {
        const lowerName = u.name.toLowerCase();
        const isCollapsed = collapsedColumns[lowerName];
        
        const col = document.createElement('section');
        col.className = `list-column glass-panel ${isCollapsed ? 'collapsed' : ''}`;
        col.id = `column-${lowerName}`;
        
        // Handle dynamic colors
        const userColor = USER_COLORS[index % USER_COLORS.length];
        col.style.setProperty('--user-color', userColor);

        col.innerHTML = `
            <div class="column-header">
                <div class="column-header-clickable" onclick="toggleColumnCollapse('${lowerName}')">
                    <i class="fa-solid fa-chevron-down toggle-arrow"></i>
                    <i class="fa-solid fa-circle-user"></i>
                    <h2>${u.name}</h2>
                </div>
                <div class="column-header-actions">
                    <button class="btn-email-column" onclick="sendEmailReport('${u.name}')" title="Enviar lista de tarefas por e-mail para ${u.name}">
                        <i class="fa-solid fa-envelope"></i>
                    </button>
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
        col.classList.remove('animating-unfold');
    } else {
        col.classList.remove('collapsed');
        container.classList.remove('collapsed');
        
        // Add class for cascade animation and remove it after animation finishes
        col.classList.add('animating-unfold');
        setTimeout(() => {
            col.classList.remove('animating-unfold');
        }, 1200); // 1.2s to cover all staggered delays
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
        const list = tasksData[lowerName.toLowerCase()] || [];
        renderColumnTasks(lowerName, list);
    });
}

// Render Specific User Tasks
function renderColumnTasks(lowerName, list) {
    const container = document.getElementById(`container-${lowerName}`);
    const countBadge = document.getElementById(`count-${lowerName}`);
    
    if (!container || !countBadge) return;

    const filteredList = filterAndSearch(list);
    
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
        card.dataset.person = lowerName;
        
        // Native HTML5 Drag and Drop listeners
        card.setAttribute('draggable', 'true');
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);
        card.addEventListener('dragover', handleDragOver);
        card.addEventListener('drop', handleDrop);
        
        const hasComment = !!item.observation;
        
        const obsId = `${lowerName}-obs-${item.row}`;
        const statusId = `${lowerName}-status-${item.row}`;
        const containerId = `${lowerName}-obs-container-${item.row}`;
        const buttonId = `${lowerName}-btn-comment-${item.row}`;

        const classificationBadge = item.classification 
            ? `<span class="class-badge badge-${item.classification}">${item.classification.toUpperCase()}</span>` 
            : '';
        
        const cardContent = `
            <div class="card-header-row">
                <div class="card-header-left">
                    <div class="drag-handle" title="Arrastar para reordenar">
                        <i class="fa-solid fa-grip-vertical"></i>
                    </div>
                    <label class="checkbox-container">
                        <input type="checkbox" ${item.completed ? 'checked' : ''} onchange="toggleTask('${lowerName}', ${item.row}, this.checked)">
                        <span class="checkmark"></span>
                    </label>
                </div>
                
                <div class="card-actions" id="actions-${lowerName}-${item.row}">
                    <div class="classification-dots">
                        <button class="dot-btn urgent ${item.classification === 'urgente' ? 'active' : ''}" onclick="changeClassification('${lowerName}', ${item.row}, 'urgente')" title="Urgente"></button>
                        <button class="dot-btn weekly ${item.classification === 'semanal' ? 'active' : ''}" onclick="changeClassification('${lowerName}', ${item.row}, 'semanal')" title="Semanal"></button>
                        <button class="dot-btn monthly ${item.classification === 'mensal' ? 'active' : ''}" onclick="changeClassification('${lowerName}', ${item.row}, 'mensal')" title="Mensal"></button>
                        <button class="dot-btn none ${!item.classification ? 'active' : ''}" onclick="changeClassification('${lowerName}', ${item.row}, 'none')" title="Limpar Classificação"></button>
                    </div>
                    <button class="btn-card-action btn-edit-task" onclick="startEditTask('${lowerName}', ${item.row})" title="Editar descrição">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn-card-action btn-delete-task" onclick="deleteTaskConfirm('${lowerName}', ${item.row})" title="Excluir pendência">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                    <button class="btn-card-action btn-image ${item.attachments && item.attachments.length > 0 ? 'has-image' : ''}" onclick="openImageModal('${lowerName}', ${item.row})" title="Arquivos anexos (Imagens/PDFs)">
                        <i class="fa-solid fa-paperclip"></i>
                    </button>
                    <button class="btn-card-action btn-date ${item.date ? 'has-date' : ''}" onclick="openDateModal('${lowerName}', ${item.row})" title="Agendar Data">
                        <i class="fa-regular fa-calendar"></i>
                    </button>
                    <button id="${buttonId}" class="btn-comment ${hasComment ? 'has-comment' : ''}" onclick="toggleComment('${lowerName}', ${item.row})" title="Observações">
                        <i class="${hasComment ? 'fa-solid fa-comment' : 'fa-regular fa-comment'}"></i>
                    </button>
                </div>
                
                <div class="card-edit-actions hidden" id="edit-actions-${lowerName}-${item.row}">
                    <button class="btn-card-action btn-save-edit" onclick="saveEditTask('${lowerName}', ${item.row})" title="Salvar">
                        <i class="fa-solid fa-check"></i>
                    </button>
                    <button class="btn-card-action btn-cancel-edit" onclick="cancelEditTask('${lowerName}', ${item.row})" title="Cancelar">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>
            
            <div class="card-body-row">
                <div class="task-content">
                    <div class="task-text-view" id="text-view-${lowerName}-${item.row}">
                        <div class="task-text">${classificationBadge}${item.task}</div>
                        ${item.date ? `
                            <div class="task-date-badge ${isOverdue(item.date, item.completed) ? 'overdue' : ''} ${item.completed ? 'completed-task-date' : ''}">
                                <i class="fa-regular fa-calendar-days"></i>
                                <span>${formatDateDisplay(item.date)}</span>
                                <button class="btn-clear-date" onclick="clearTaskDate('${lowerName}', ${item.row})" title="Remover data agendada">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                        ` : ''}
                    </div>
                    <div class="task-text-edit hidden" id="text-edit-${lowerName}-${item.row}">
                        <textarea class="task-edit-input" id="input-${lowerName}-${item.row}">${item.task}</textarea>
                    </div>
                </div>
            </div>
            
            <div id="${containerId}" class="observation-container collapsed">
                <div class="observation-box">
                    <textarea id="${obsId}" class="observation-input" placeholder="Adicionar observações..." rows="1" oninput="autoResizeTextarea(this); saveObservationDebounced('${lowerName}', ${item.row}, this.value, '${lowerName}', '${statusId}', '${buttonId}')">${item.observation || ''}</textarea>
                    <div id="${statusId}" class="observation-status">
                        <i class="fa-solid fa-spinner fa-spin icon-saving"></i>
                        <i class="fa-solid fa-check icon-saved"></i>
                    </div>
                </div>
            </div>
        `;
        
        card.innerHTML = cardContent;
        
        // Touch dragging support for mobile
        const handle = card.querySelector('.drag-handle');
        if (handle) {
            handle.addEventListener('touchstart', handleTouchStart, { passive: false });
            handle.addEventListener('touchmove', handleTouchMove, { passive: false });
            handle.addEventListener('touchend', handleTouchEnd);
        }
        
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
        autoResizeTextarea(textarea);
        setTimeout(() => {
            textarea.focus();
            autoResizeTextarea(textarea);
        }, 100);
    } else {
        // Close
        container.classList.add('collapsed');
    }
}

let selectedImageBase64 = null;
let selectedImageMime = null;

// Open Attachments Modal
function openImageModal(person, row) {
    const item = (tasksData[person.toLowerCase()] || []).find(i => i.row === row);
    if (!item) return;
    const taskText = item.task;

    document.getElementById('task-image-person').value = person;
    document.getElementById('task-image-row').value = row;
    document.getElementById('task-image-text').value = taskText;
    
    // Set Task description title
    document.getElementById('task-image-task-desc').textContent = taskText;
    
    // Clear selected file input
    document.getElementById('task-image-file-input').value = '';
    
    // Fetch attachments from tasksData memory
    const attachments = item ? (item.attachments || []) : [];
    
    renderAttachmentsList(person, row, attachments);
    openModal('modal-task-image');
}

// Render dynamic attachments cards list in modal
function renderAttachmentsList(person, row, attachments) {
    const container = document.getElementById('attachments-container');
    container.innerHTML = '';
    
    // Render existing attachments
    attachments.forEach(att => {
        const itemEl = document.createElement('div');
        itemEl.className = 'attachment-item';
        
        let previewHtml = '';
        if (att.mimeType === 'application/pdf') {
            previewHtml = `
                <iframe src="/uploads/${att.filename}#toolbar=0" scrolling="yes"></iframe>
            `;
        } else {
            // Image preview
            previewHtml = `<img src="/uploads/${att.filename}" alt="${att.originalName}" onclick="window.open('/uploads/${att.filename}', '_blank')">`;
        }
        
        itemEl.innerHTML = `
            <span class="attachment-name" title="${att.originalName}">${att.originalName}</span>
            <div class="attachment-preview">
                ${previewHtml}
            </div>
            <button class="btn btn-secondary" onclick="deleteAttachment('${att.filename}')" style="background: rgba(220, 53, 69, 0.1); border-color: rgba(220, 53, 69, 0.2); color: #ff5f70; margin-top: 4px; padding: 4px 8px; font-size: 0.75rem;" title="Remover anexo">
                <i class="fa-solid fa-trash-can"></i> Remover
            </button>
        `;
        container.appendChild(itemEl);
    });
    
    // Render the Add Attachment Card
    const addCard = document.createElement('div');
    addCard.className = 'attachment-upload-zone';
    addCard.onclick = triggerImageFileInput;
    addCard.innerHTML = `
        <i class="fa-solid fa-cloud-arrow-up"></i>
        <span>Adicionar Anexo</span>
        <span style="font-size: 0.7rem; opacity: 0.7; text-align: center; padding: 0 10px;">Formatos: Imagens ou PDFs (Até 15MB)</span>
    `;
    container.appendChild(addCard);
}

// Trigger hidden file input
function triggerImageFileInput() {
    document.getElementById('task-image-file-input').click();
}

// Handle local file selection and upload instantly
async function handleImageFileSelected(input) {
    const file = input.files[0];
    if (!file) return;
    
    // Check file size (limit to 15MB)
    if (file.size > 15 * 1024 * 1024) {
        showToast('O arquivo selecionado é muito grande. Limite de 15MB.', true);
        input.value = '';
        return;
    }
    
    const person = document.getElementById('task-image-person').value;
    const row = Number(document.getElementById('task-image-row').value);
    const task = document.getElementById('task-image-text').value;
    
    // Show spinner inside the add button card in modal
    const addCard = document.querySelector('.attachment-upload-zone');
    if (addCard) {
        addCard.innerHTML = `
            <i class="fa-solid fa-spinner fa-spin" style="font-size: 2rem; color: #a855f7;"></i>
            <span>Enviando arquivo...</span>
        `;
        addCard.style.pointerEvents = 'none';
    }
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        const base64Data = e.target.result;
        
        try {
            const res = await fetch('/api/tasks/image/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    person,
                    task,
                    imageBase64: base64Data,
                    mimeType: file.type,
                    originalName: file.name
                })
            });
            
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao fazer upload.');
            
            // Update local memory
            const item = (tasksData[person.toLowerCase()] || []).find(i => i.row === row);
            if (item) {
                item.attachments = data.attachments;
            }
            
            // Refresh modal attachments list
            renderAttachmentsList(person, row, data.attachments);
            
            // Refresh the grid card icon state
            renderColumnTasks(person, tasksData[person.toLowerCase()]);
            
            showToast('Arquivo enviado com sucesso!');
        } catch (err) {
            console.error(err);
            showToast('Erro ao enviar arquivo: ' + err.message, true);
            // Reset add card state
            const item = (tasksData[person.toLowerCase()] || []).find(i => i.row === row);
            if (item) {
                renderAttachmentsList(person, row, item.attachments || []);
            }
        } finally {
            input.value = '';
        }
    };
    reader.readAsDataURL(file);
}

// Delete specific attachment file
async function deleteAttachment(filename) {
    if (!confirm('Deseja realmente remover este arquivo?')) return;
    
    const person = document.getElementById('task-image-person').value;
    const row = Number(document.getElementById('task-image-row').value);
    const task = document.getElementById('task-image-text').value;
    
    try {
        const res = await fetch('/api/tasks/image/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ person, task, filename })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao remover arquivo.');
        
        // Update local memory
        const item = (tasksData[person.toLowerCase()] || []).find(i => i.row === row);
        if (item) {
            item.attachments = data.attachments;
        }
        
        // Refresh modal attachments list
        renderAttachmentsList(person, row, data.attachments);
        
        // Refresh the grid card icon state
        renderColumnTasks(person, tasksData[person.toLowerCase()]);
        
        showToast('Arquivo removido com sucesso!');
    } catch (err) {
        console.error(err);
        showToast('Erro ao remover arquivo: ' + err.message, true);
    }
}

// Toggle Task Complete (Optimistic Update)
async function toggleTask(person, row, checked) {
    const item = (tasksData[person.toLowerCase()] || []).find(i => i.row === row);
    if (item) {
        item.completed = checked;
        
        // Find card in DOM and add class instantly (using attribute selector to support spaces in user names)
        const cards = document.querySelectorAll(`[id="container-${person}"] .task-card`);
        for (let card of cards) {
            if (Number(card.dataset.row) === row) {
                if (checked) card.classList.add('completed');
                else card.classList.remove('completed');
                break;
            }
        }
        
        // Update badge
        const pendingCount = tasksData[person.toLowerCase()].filter(i => !i.completed).length;
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
            renderColumnTasks(person, tasksData[person.toLowerCase()]);
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
            const item = (tasksData[person.toLowerCase()] || []).find(i => i.row === row);
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
        
        const col = document.getElementById(`column-${ownerId}`);
        if (col) {
            col.classList.add('animating-unfold');
            setTimeout(() => {
                col.classList.remove('animating-unfold');
            }, 1200);
        }

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
    // Show Delete User Button
    document.getElementById('btn-delete-user').classList.remove('hidden');
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
    // Hide Delete User Button
    document.getElementById('btn-delete-user').classList.add('hidden');
    // Show Close Modal Button
    document.getElementById('btn-cancel-user-modal').classList.remove('hidden');
}

// Handle Delete User Click
async function handleDeleteUser() {
    if (!editingUser) return;
    
    const confirmDelete = confirm(`Deseja realmente EXCLUIR o usuário "${editingUser}"? Todas as tarefas dele serão apagadas da planilha.`);
    if (!confirmDelete) return;
    
    try {
        const res = await fetch('/api/users', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: editingUser })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao excluir usuário.');
        
        showToast(`Usuário "${editingUser}" excluído com sucesso!`);
        cancelEditUser();
        closeModal('modal-register-user');
        
        // Reload configuration and tasks
        await fetchUsers();
    } catch (err) {
        console.error(err);
        showToast(err.message, true);
    }
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
        renderColumnTasks(person.toLowerCase(), userList);

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
        if (newClassification === 'urgente') {
            await fetchTasks();
        } else {
            renderColumnTasks(person.toLowerCase(), userList);
        }
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
                renderCalendar();
            }
        } catch (err) {
            console.error('Erro no polling:', err);
        }
    }, 10000);
}

// Switch between dashboard, tasks board and calendar views
function switchView(viewName) {
    currentView = viewName;
    const tasksView = document.getElementById('tasks-view');
    const dashboardView = document.getElementById('dashboard-view');
    const calendarView = document.getElementById('calendar-view');
    
    if (viewName === 'tasks') {
        tasksView.classList.remove('hidden');
        dashboardView.classList.add('hidden');
        calendarView.classList.add('hidden');
        renderAllTasks();
    } else if (viewName === 'dashboard') {
        tasksView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        calendarView.classList.add('hidden');
        renderDashboard();
    } else if (viewName === 'calendar') {
        tasksView.classList.add('hidden');
        dashboardView.classList.add('hidden');
        calendarView.classList.remove('hidden');
        renderCalendar();
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
        const userList = tasksData[lowerName.toLowerCase()] || [];
        
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

    userStats.forEach((stat, index) => {
        const lowerName = stat.user.name.toLowerCase();
        
        // Progress segments percentages
        const total = stat.count || 1; // avoid division by zero
        const urgentPct = stat.count ? (stat.urgentCount / total) * 100 : 0;
        const weeklyPct = stat.count ? (stat.weeklyCount / total) * 100 : 0;
        const monthlyPct = stat.count ? (stat.monthlyCount / total) * 100 : 0;
        const nonePct = stat.count ? (stat.noneCount / total) * 100 : 0;

        const card = document.createElement('div');
        card.className = 'user-summary-card glass-panel';
        
        const userColor = USER_COLORS[index % USER_COLORS.length];
        card.style.setProperty('--user-color', userColor);

        // Set click behavior to jump to the user's column
        card.addEventListener('click', () => {
            // 1. Switch back to tasks view
            document.querySelectorAll('.view-tab-btn[data-view]').forEach(btn => {
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

// Send active tasks report via mailto client
function sendEmailReport(userName) {
    const lowerName = userName.toLowerCase();
    const user = users.find(u => u.name.toLowerCase() === lowerName);
    if (!user) return;

    const userList = tasksData[lowerName.toLowerCase()] || [];
    const openTasks = userList.filter(t => !t.completed);

    if (openTasks.length === 0) {
        showToast(`Nenhuma pendência ativa para ${user.name}!`);
        return;
    }

    const email = user.email || '';
    const cc = 'giovani@confeccoesoneda.com.br';
    const subject = `📊 Suas Pendências do GT App - ${new Date().toLocaleDateString('pt-BR')}`;
    
    let body = `Olá ${user.name},\n\n`;
    body += `Aqui está a lista de suas pendências em aberto no GT App:\n\n`;
    
    openTasks.forEach(t => {
        let prefix = '• ';
        if (t.classification === 'urgente') prefix = '• [URGENTE] ';
        else if (t.classification === 'semanal') prefix = '• [SEMANAL] ';
        else if (t.classification === 'mensal') prefix = '• [MENSAL] ';
        
        body += `${prefix}${t.task}\n`;
        if (t.observation) {
            body += `  (Obs: ${t.observation})\n`;
        }
    });
    
    body += `\nPara atualizar o status ou adicionar observações, acesse:\n`;
    body += `https://tasks.136-248-111-213.sslip.io\n`;

    const mailtoUrl = `mailto:${encodeURIComponent(email)}?cc=${encodeURIComponent(cc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    
    window.location.href = mailtoUrl;
}

// Task reordering state variables
let dragSrcRow = null;
let dragSrcPerson = null;

// HTML5 Drag and Drop handlers
function handleDragStart(e) {
    e.stopPropagation();
    const card = e.currentTarget;
    card.classList.add('dragging');
    dragSrcRow = Number(card.dataset.row);
    dragSrcPerson = card.dataset.person;
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    e.stopPropagation();
    e.currentTarget.classList.remove('dragging');
    dragSrcRow = null;
    dragSrcPerson = null;
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

async function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const targetCard = e.currentTarget;
    const destPerson = targetCard.dataset.person;
    const destRow = Number(targetCard.dataset.row);

    // Only allow drag and drop within the same user's column
    if (dragSrcPerson !== destPerson || dragSrcRow === destRow) return;

    const list = tasksData[destPerson];
    const fromIndex = list.findIndex(t => t.row === dragSrcRow);
    const toIndex = list.findIndex(t => t.row === destRow);

    if (fromIndex === -1 || toIndex === -1) return;

    // Move task in local list
    const [movedTask] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, movedTask);

    // Optimistically re-render this column
    renderColumnTasks(destPerson, list);

    // Save the new rows order to Sheets
    const newRowsOrder = list.map(t => t.row);
    await saveNewTasksOrder(destPerson, newRowsOrder);
}

// Move task Up or Down via button
async function moveTaskUpDown(person, row, direction) {
    const list = tasksData[person.toLowerCase()];
    const idx = list.findIndex(t => t.row === row);
    if (idx === -1) return;

    let targetIdx = idx;
    if (direction === 'up' && idx > 0) {
        targetIdx = idx - 1;
    } else if (direction === 'down' && idx < list.length - 1) {
        targetIdx = idx + 1;
    }

    if (targetIdx === idx) return;

    // Swap locally
    const [movedTask] = list.splice(idx, 1);
    list.splice(targetIdx, 0, movedTask);

    // Optimistically re-render
    renderColumnTasks(person, list);

    // Save order
    const newRowsOrder = list.map(t => t.row);
    await saveNewTasksOrder(person, newRowsOrder);
}

// Delete task from app and Sheets (shifting values up)
async function deleteTaskConfirm(person, row) {
    if (!confirm('Deseja realmente excluir esta pendência? Ela será removida da planilha também.')) return;

    const list = tasksData[person.toLowerCase()];
    const newList = list.filter(t => t.row !== row);

    // Optimistically re-render
    renderColumnTasks(person, newList);

    // Save order (which automatically handles deleting the omitted row!)
    const newRowsOrder = newList.map(t => t.row);
    await saveNewTasksOrder(person, newRowsOrder);
}

// Edit Task Inline
function startEditTask(person, row) {
    document.getElementById(`text-view-${person}-${row}`).classList.add('hidden');
    document.getElementById(`actions-${person}-${row}`).classList.add('hidden');
    
    document.getElementById(`text-edit-${person}-${row}`).classList.remove('hidden');
    document.getElementById(`edit-actions-${person}-${row}`).classList.remove('hidden');
    
    const input = document.getElementById(`input-${person}-${row}`);
    input.focus();
    // Put cursor at the end
    const val = input.value;
    input.value = '';
    input.value = val;
}

// Cancel Inline Edit
function cancelEditTask(person, row) {
    const item = (tasksData[person.toLowerCase()] || []).find(t => t.row === row);
    if (item) {
        document.getElementById(`input-${person}-${row}`).value = item.task;
    }
    
    document.getElementById(`text-view-${person}-${row}`).classList.remove('hidden');
    document.getElementById(`actions-${person}-${row}`).classList.remove('hidden');
    
    document.getElementById(`text-edit-${person}-${row}`).classList.add('hidden');
    document.getElementById(`edit-actions-${person}-${row}`).classList.add('hidden');
}

// Save Inline Edit
async function saveEditTask(person, row) {
    const input = document.getElementById(`input-${person}-${row}`);
    const newText = input.value.trim();
    if (!newText) {
        showToast('A pendência não pode ficar vazia.', true);
        return;
    }

    try {
        const res = await fetch('/api/tasks/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                row,
                person,
                task: newText
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao editar tarefa.');

        const item = (tasksData[person.toLowerCase()] || []).find(t => t.row === row);
        if (item) {
            item.task = newText;
        }

        renderColumnTasks(person, tasksData[person.toLowerCase()]);
        showToast('Pendência atualizada!');
    } catch (err) {
        console.error(err);
        showToast(err.message, true);
        cancelEditTask(person, row);
    }
}

// Call backend to update the order of rows or delete
async function saveNewTasksOrder(person, newRowsOrder) {
    try {
        const res = await fetch('/api/tasks/update-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                person,
                newRowsOrder
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao reordenar tarefas.');
        
        showToast('Planilha atualizada com sucesso!');
        await fetchTasks(); // Refresh to fetch correct row numbers
    } catch (err) {
        console.error(err);
        showToast(err.message, true);
        await fetchTasks(); // Rollback on error
    }
}

// Touch dragging support for mobile (Google Tasks style)
let touchStartY = 0;
let touchActiveCard = null;
let touchActivePerson = null;

function handleTouchStart(e) {
    const handle = e.currentTarget;
    const card = handle.closest('.task-card');
    if (!card) return;
    
    touchActiveCard = card;
    touchActivePerson = card.dataset.person;
    touchStartY = e.touches[0].clientY;
    card.classList.add('dragging');
}

function handleTouchMove(e) {
    if (!touchActiveCard) return;
    // Prevent default scrolling when dragging
    if (e.cancelable) e.preventDefault();
}

async function handleTouchEnd(e) {
    if (!touchActiveCard) return;
    touchActiveCard.classList.remove('dragging');
    
    const touchY = e.changedTouches[0].clientY;
    const touchX = e.changedTouches[0].clientX;
    
    // Find element under touch point
    const element = document.elementFromPoint(touchX, touchY);
    const targetCard = element ? element.closest('.task-card') : null;
    
    if (targetCard && targetCard !== touchActiveCard && targetCard.dataset.person === touchActivePerson) {
        const destPerson = touchActivePerson;
        const srcRow = Number(touchActiveCard.dataset.row);
        const destRow = Number(targetCard.dataset.row);
        
        const list = tasksData[destPerson];
        const fromIndex = list.findIndex(t => t.row === srcRow);
        const toIndex = list.findIndex(t => t.row === destRow);
        
        if (fromIndex !== -1 && toIndex !== -1) {
            const [movedTask] = list.splice(fromIndex, 1);
            list.splice(toIndex, 0, movedTask);
            
            // Optimistically re-render
            renderColumnTasks(destPerson, list);
            
            // Save new order to Sheets
            const newRowsOrder = list.map(t => t.row);
            await saveNewTasksOrder(destPerson, newRowsOrder);
        }
    }
    
    touchActiveCard = null;
    touchActivePerson = null;
}

// Date Scheduling Functions

// Open Date Selector Modal
function openDateModal(person, row) {
    const item = (tasksData[person.toLowerCase()] || []).find(i => Number(i.row) === Number(row));
    if (!item) return;
    const taskText = item.task;
    const currentDate = item.date;

    document.getElementById('task-date-person').value = person;
    document.getElementById('task-date-row').value = row;
    document.getElementById('task-date-text').value = taskText;
    
    document.getElementById('task-date-task-desc').textContent = `Tarefa: "${taskText}"`;
    
    const dateInput = document.getElementById('task-date-input');
    if (dateInput) {
        try {
            let val = '';
            if (currentDate) {
                if (currentDate.includes('T')) {
                    val = currentDate;
                } else {
                    val = `${currentDate}T12:00`;
                }
            }
            dateInput.value = val;
        } catch (e) {
            console.error('Erro ao definir data:', e);
        }
    }
    
    const deleteBtn = document.getElementById('btn-delete-task-date');
    if (deleteBtn) {
        if (currentDate) {
            deleteBtn.classList.remove('hidden');
        } else {
            deleteBtn.classList.add('hidden');
        }
    }
    
    openModal('modal-task-date');
}

// Save Task Date Scheduling
async function saveTaskDate() {
    const person = document.getElementById('task-date-person').value;
    const row = Number(document.getElementById('task-date-row').value);
    const task = document.getElementById('task-date-text').value;
    const date = document.getElementById('task-date-input').value;
    
    if (!date) {
        showToast('Selecione uma data válida ou clique em Limpar Data.', true);
        return;
    }
    
    try {
        const res = await fetch('/api/tasks/date/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ person, task, date })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao agendar data.');
        
        // Update local memory
        const item = (tasksData[person.toLowerCase()] || []).find(i => i.row === row);
        if (item) {
            item.date = date;
        }
        
        // Refresh grid
        renderColumnTasks(person, tasksData[person.toLowerCase()]);
        
        // Refresh calendar if active
        if (currentView === 'calendar') {
            renderCalendar();
        }
        
        showToast('Data agendada com sucesso!');
        closeModal('modal-task-date');
    } catch (err) {
        console.error(err);
        showToast('Erro ao agendar data: ' + err.message, true);
    }
}

// Clear Task Date Scheduling
async function deleteTaskDate() {
    const person = document.getElementById('task-date-person').value;
    const row = Number(document.getElementById('task-date-row').value);
    
    await clearTaskDate(person, row);
    closeModal('modal-task-date');
}

// Generic function to clear a task's date
async function clearTaskDate(person, row) {
    const item = (tasksData[person.toLowerCase()] || []).find(i => i.row === row);
    if (!item) return;
    const task = item.task;

    try {
        const res = await fetch('/api/tasks/date/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ person, task })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao remover data.');
        
        // Update local memory
        if (item) {
            item.date = null;
        }
        
        // Refresh grid
        renderColumnTasks(person, tasksData[person.toLowerCase()]);
        
        // Refresh calendar if active
        if (currentView === 'calendar') {
            renderCalendar();
        }
        
        showToast('Data agendada removida!');
    } catch (err) {
        console.error(err);
        showToast('Erro ao remover data: ' + err.message, true);
    }
}

// Clear all scheduled dates for all tasks
async function clearAllTaskDates() {
    if (!confirm('Deseja realmente remover e limpar todas as datas agendadas de todas as tarefas?')) return;
    
    let clearedCount = 0;
    const promises = [];
    
    for (const person in tasksData) {
        tasksData[person.toLowerCase()].forEach(item => {
            if (item.date) {
                clearedCount++;
                promises.push(
                    fetch('/api/tasks/date/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ person, task: item.task })
                    }).then(async res => {
                        if (res.ok) {
                            item.date = null;
                        }
                    })
                );
            }
        });
    }
    
    if (clearedCount === 0) {
        showToast('Não há nenhuma tarefa agendada para limpar.');
        return;
    }
    
    try {
        await Promise.all(promises);
        
        // Rerender everything
        renderAllTasks();
        if (currentView === 'calendar') {
            renderCalendar();
        }
        
        showToast(`Limpamos ${clearedCount} data(s) agendada(s) com sucesso!`);
    } catch (err) {
        console.error(err);
        showToast('Erro ao limpar datas agendadas: ' + err.message, true);
    }
}

// Render dynamic Calendar tab view
function renderCalendar() {
    const container = document.getElementById('calendar-days-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Group all active scheduled tasks by date
    const tasksByDate = {};
    
    for (const person in tasksData) {
        const userObj = users.find(u => u.name.toLowerCase() === person.toLowerCase());
        const userColor = userObj ? USER_COLORS[users.indexOf(userObj) % USER_COLORS.length] : '#00ff88';
        
        tasksData[person.toLowerCase()].forEach(item => {
            if (item.date) {
                // Group by date part only (YYYY-MM-DD)
                const dayKey = item.date.split('T')[0];
                if (!tasksByDate[dayKey]) {
                    tasksByDate[dayKey] = [];
                }
                tasksByDate[dayKey].push({
                    personName: userObj ? userObj.name : person,
                    personKey: person,
                    row: item.row,
                    task: item.task,
                    completed: item.completed,
                    userColor: userColor,
                    dateTime: item.date
                });
            }
        });
    }
    
    // Sort dates chronologically
    const sortedDates = Object.keys(tasksByDate).sort();
    
    if (sortedDates.length === 0) {
        container.innerHTML = `
            <div class="loader-inner" style="color: var(--text-muted); font-size: 0.95rem; text-align: center; padding: 40px 0;">
                <i class="fa-regular fa-calendar-xmark" style="font-size: 2rem; margin-bottom: 12px; display: block; opacity: 0.5;"></i>
                Nenhuma tarefa agendada encontrada.
            </div>
        `;
        return;
    }
    
    sortedDates.forEach(dateStr => {
        const groupEl = document.createElement('div');
        groupEl.className = 'calendar-day-group';
        
        const dayHeader = document.createElement('h3');
        dayHeader.className = 'calendar-day-header';
        dayHeader.innerHTML = `<i class="fa-regular fa-calendar-check"></i> ${formatFullDateDisplay(dateStr)}`;
        groupEl.appendChild(dayHeader);
        
        const tasksContainer = document.createElement('div');
        tasksContainer.className = 'calendar-day-tasks';
        
        // Sort tasks within the same day chronologically by full date/time string
        tasksByDate[dateStr].sort((a, b) => a.dateTime.localeCompare(b.dateTime));
        
        tasksByDate[dateStr].forEach(t => {
            const taskItem = document.createElement('div');
            taskItem.className = 'calendar-task-item';
            
            const isTaskOverdue = isOverdue(t.dateTime, t.completed);
            const timePart = t.dateTime.includes('T') ? t.dateTime.split('T')[1] : '';
            const timeDisplay = timePart ? ` <span class="cal-task-time" style="opacity: 0.8; font-size: 0.85rem; margin-left: 6px; padding: 1px 6px; background: rgba(255,255,255,0.06); border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-regular fa-clock"></i> ${timePart}</span>` : '';
            
            taskItem.innerHTML = `
                <div class="calendar-task-info ${t.completed ? 'completed' : ''} ${isTaskOverdue ? 'overdue' : ''}">
                    <span class="calendar-task-owner" style="background: ${t.userColor}20; color: ${t.userColor}; border: 1px solid ${t.userColor}40;">
                        ${t.personName}
                    </span>
                    <span>${t.task}${timeDisplay}</span>
                </div>
                <button class="btn-clear-date-cal" onclick="clearTaskDate('${t.personKey}', ${t.row})" title="Remover data agendada">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            `;
            tasksContainer.appendChild(taskItem);
        });
        
        groupEl.appendChild(tasksContainer);
        container.appendChild(groupEl);
    });
}
