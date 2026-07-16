const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3020;

const TOKEN_PATH = path.join(__dirname, '../token.json');
const USERS_PATH = path.join(__dirname, 'users.json');
const TASKS_SPREADSHEET_ID = '1vT9cyW60L-_UJ2ySy-JDUMsirAEfLpYxkZ6zkMEMf3E';

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// Helper to convert column index to Excel-like letter (e.g. 3 -> D, 26 -> AA)
function indexToColumnLetter(index) {
  let letter = '';
  let temp = index;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

// Auth Helper
function getOAuth2Client() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error('Token de autenticação não encontrado localmente.');
  }
  const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const oauth2Client = new google.auth.OAuth2(
    tokenData.client_id,
    tokenData.client_secret,
    tokenData.token_uri || 'https://oauth2.googleapis.com/token'
  );
  oauth2Client.setCredentials({
    access_token: tokenData.token,
    refresh_token: tokenData.refresh_token,
    expiry_date: tokenData.expiry ? new Date(tokenData.expiry).getTime() : null
  });
  return oauth2Client;
}

// Load users helper
function loadUsers() {
  if (!fs.existsSync(USERS_PATH)) {
    // Default fallback
    const defaults = [
      { name: "Ketlyn", email: "ketlyn@confeccoesoneda.com.br", taskCol: "D", obsCol: "E", colIdx: 3 },
      { name: "Ariel", email: "ariel@confeccoesoneda.com.br", taskCol: "F", obsCol: "G", colIdx: 5 }
    ];
    fs.writeFileSync(USERS_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  } catch (e) {
    console.error("Erro ao ler users.json:", e);
    return [];
  }
}

const IMAGES_FILE = path.join(__dirname, 'data', 'task_images.json');
const DATES_FILE = path.join(__dirname, 'data', 'task_dates.json');

// Ensure directory and file exist
function initImagesStorage() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  if (!fs.existsSync(IMAGES_FILE)) {
    fs.writeFileSync(IMAGES_FILE, JSON.stringify({}), 'utf8');
  }
  if (!fs.existsSync(DATES_FILE)) {
    fs.writeFileSync(DATES_FILE, JSON.stringify({}), 'utf8');
  }
}

function loadImagesMap() {
  try {
    initImagesStorage();
    if (fs.existsSync(IMAGES_FILE)) {
      return JSON.parse(fs.readFileSync(IMAGES_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading task images:', e);
  }
  return {};
}

function saveImagesMap(map) {
  try {
    initImagesStorage();
    fs.writeFileSync(IMAGES_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving task images:', e);
  }
}

function loadDatesMap() {
  try {
    initImagesStorage();
    if (fs.existsSync(DATES_FILE)) {
      return JSON.parse(fs.readFileSync(DATES_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading task dates:', e);
  }
  return {};
}

function saveDatesMap(map) {
  try {
    initImagesStorage();
    fs.writeFileSync(DATES_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving task dates:', e);
  }
}

const COMPROMISSOS_ID_FILE = path.join(__dirname, 'data', 'compromissos_spreadsheet_id.txt');

async function getOrCreateCompromissosSpreadsheet() {
  if (fs.existsSync(COMPROMISSOS_ID_FILE)) {
    const id = fs.readFileSync(COMPROMISSOS_ID_FILE, 'utf8').trim();
    if (id) return id;
  }

  try {
    const auth = getOAuth2Client();
    const sheets = google.sheets({ version: 'v4', auth });
    
    const res = await sheets.spreadsheets.create({
      resource: {
        properties: {
          title: 'compromissos APP'
        },
        sheets: [
          {
            properties: {
              title: 'Agenda'
            }
          }
        ]
      }
    });
    
    const spreadsheetId = res.data.spreadsheetId;
    fs.writeFileSync(COMPROMISSOS_ID_FILE, spreadsheetId, 'utf8');
    console.log('Criada nova planilha de compromissos com ID:', spreadsheetId);
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Agenda!A1:D1',
      valueInputOption: 'RAW',
      resource: {
        values: [['Data', 'Responsável', 'Tarefa', 'Status']]
      }
    });
    
    return spreadsheetId;
  } catch (error) {
    console.error('Erro ao criar planilha compromissos APP:', error);
    throw error;
  }
}

async function getActiveTasksWithDates() {
  const users = loadUsers();
  if (users.length === 0) return [];
  
  let maxColIdx = 3;
  users.forEach(u => {
    if (u.colIdx + 1 > maxColIdx) maxColIdx = u.colIdx + 1;
  });
  
  const maxColLetter = indexToColumnLetter(maxColIdx);
  const auth = getOAuth2Client();
  const sheets = google.sheets({ version: 'v4', auth });
  
  const tasksResponse = await sheets.spreadsheets.get({
    spreadsheetId: TASKS_SPREADSHEET_ID,
    ranges: [`'APP '!D1:${maxColLetter}150`],
    fields: "sheets(properties(sheetId),data(rowData(values(userEnteredValue,effectiveValue,formattedValue,effectiveFormat,userEnteredFormat))))"
  });
  
  const sheetData = tasksResponse.data.sheets[0].data[0];
  const rowData = sheetData.rowData || [];
  const datesMap = loadDatesMap();
  const list = [];
  
  const getCellDetail = (values, relIdx) => {
    if (!values || relIdx >= values.length) return { val: '', strikethrough: false };
    const cell = values[relIdx];
    let val = '';
    if (cell) {
      if (cell.formattedValue !== undefined) val = cell.formattedValue;
      else if (cell.effectiveValue && Object.keys(cell.effectiveValue).length > 0) {
        const keys = Object.keys(cell.effectiveValue);
        val = String(cell.effectiveValue[keys[0]]);
      } else if (cell.userEnteredValue && cell.userEnteredValue.formulaValue === undefined) {
        const keys = Object.keys(cell.userEnteredValue);
        if (keys.length > 0) val = String(cell.userEnteredValue[keys[0]]);
      }
    }
    
    let strikethrough = false;
    if (cell && cell.effectiveFormat && cell.effectiveFormat.textFormat && cell.effectiveFormat.textFormat.strikethrough) {
      strikethrough = true;
    } else if (cell && cell.userEnteredFormat && cell.userEnteredFormat.textFormat && cell.userEnteredFormat.textFormat.strikethrough) {
      strikethrough = true;
    }
    return { val, strikethrough };
  };
  
  rowData.forEach((row, r_idx) => {
    if (r_idx < 3) return;
    const values = row.values || [];
    
    users.forEach(u => {
      const relTaskIdx = u.colIdx - 3;
      const taskData = getCellDetail(values, relTaskIdx);
      
      if (taskData.val) {
        const upperVal = taskData.val.toUpperCase();
        let cleanTask = taskData.val;
        if (upperVal.startsWith('[URGENTE]')) cleanTask = cleanTask.substring(9).trim();
        else if (upperVal.startsWith('[SEMANAL]')) cleanTask = cleanTask.substring(9).trim();
        else if (upperVal.startsWith('[MENSAL]')) cleanTask = cleanTask.substring(8).trim();
        
        const taskKey = getTaskKey(u.name, cleanTask);
        const date = datesMap[taskKey];
        
        if (date) {
          list.push({
            personName: u.name,
            task: cleanTask,
            completed: taskData.strikethrough,
            date: date
          });
        }
      }
    });
  });
  
  return list;
}

async function syncCompromissosSheet() {
  try {
    const spreadsheetId = await getOrCreateCompromissosSpreadsheet();
    const tasksList = await getActiveTasksWithDates();
    
    // Sort tasks chronologically by date-time string
    tasksList.sort((a, b) => a.date.localeCompare(b.date));
    
    const rows = [['Data', 'Responsável', 'Tarefa', 'Status']];
    tasksList.forEach(t => {
      let formattedDate = t.date;
      if (t.date.includes('T')) {
        const [dPart, tPart] = t.date.split('T');
        const [yr, mo, dy] = dPart.split('-');
        formattedDate = `${dy}/${mo}/${yr} ${tPart}`;
      } else {
        const [yr, mo, dy] = t.date.split('-');
        formattedDate = `${dy}/${mo}/${yr}`;
      }

      rows.push([
        formattedDate,
        t.personName,
        t.task,
        t.completed ? 'Concluída' : 'Pendente'
      ]);
    });
    
    const auth = getOAuth2Client();
    const sheets = google.sheets({ version: 'v4', auth });
    
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: 'Agenda!A2:D500'
    });
    
    if (rows.length > 1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Agenda!A1:D${rows.length}`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: rows
        }
      });
    }
    console.log('Planilha de compromissos sincronizada.');
  } catch (e) {
    console.error('Erro ao sincronizar compromissos APP:', e);
  }
}

function getTaskKey(owner, taskText) {
  if (!taskText) return '';
  const cleanText = taskText.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${owner.toLowerCase()}_${cleanText}`;
}

// Initialize images folders and JSON map file
initImagesStorage();

// Get user list
app.get('/api/users', (req, res) => {
  const users = loadUsers();
  res.json(users);
});

// Register new user
app.post('/api/users', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'Nome e E-mail são obrigatórios.' });
  }

  try {
    const users = loadUsers();
    
    // Check if name already exists (case-insensitive)
    if (users.some(u => u.name.toLowerCase() === name.toLowerCase())) {
      return res.status(400).json({ error: 'Usuário com este nome já cadastrado.' });
    }

    // Determine column indices
    let maxColIdx = 1; // start after first columns if empty
    users.forEach(u => {
      if (u.colIdx > maxColIdx) maxColIdx = u.colIdx;
    });
    
    const newColIdx = maxColIdx + 2; // next pair of columns
    const taskCol = indexToColumnLetter(newColIdx);
    const obsCol = indexToColumnLetter(newColIdx + 1);

    const newUser = {
      name,
      email,
      taskCol,
      obsCol,
      colIdx: newColIdx
    };

    // Write name to Sheet header in row 3
    const auth = getOAuth2Client();
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.update({
      spreadsheetId: TASKS_SPREADSHEET_ID,
      range: `'APP '!${taskCol}3`,
      valueInputOption: "RAW",
      resource: {
        values: [[name]]
      }
    });

    // Save to users.json
    users.push(newUser);
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));

    res.json(newUser);

  } catch (error) {
    console.error('Erro ao registrar usuário:', error);
    res.status(500).json({ error: 'Erro ao registrar usuário no Sheets: ' + error.message });
  }
});

// Update user information
app.put('/api/users', async (req, res) => {
  const { originalName, name, email } = req.body;
  if (!originalName || !name || !email) {
    return res.status(400).json({ error: 'Nome original, novo nome e e-mail são obrigatórios.' });
  }

  try {
    const users = loadUsers();
    const userIndex = users.findIndex(u => u.name.toLowerCase() === originalName.toLowerCase());

    if (userIndex === -1) {
      return res.status(404).json({ error: `Usuário '${originalName}' não encontrado.` });
    }

    // Check if new name already exists for other users
    const nameConflict = users.some((u, idx) => idx !== userIndex && u.name.toLowerCase() === name.toLowerCase());
    if (nameConflict) {
      return res.status(400).json({ error: 'Usuário com este nome já cadastrado.' });
    }

    const user = users[userIndex];
    const nameChanged = user.name.toLowerCase() !== name.toLowerCase();

    if (nameChanged) {
      // Write new name to Sheet header in row 3
      const auth = getOAuth2Client();
      const sheets = google.sheets({ version: 'v4', auth });

      await sheets.spreadsheets.values.update({
        spreadsheetId: TASKS_SPREADSHEET_ID,
        range: `'APP '!${user.taskCol}3`,
        valueInputOption: "RAW",
        resource: {
          values: [[name]]
        }
      });
    }

    // Update locally
    user.name = name;
    user.email = email;

    // Save to users.json
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));

    res.json(user);

  } catch (error) {
    console.error('Erro ao atualizar usuário:', error);
    res.status(500).json({ error: 'Erro ao atualizar usuário no Sheets: ' + error.message });
  }
});

// Delete user and clear their columns in the spreadsheet
app.delete('/api/users', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Nome do usuário é obrigatório.' });
  }

  try {
    const users = loadUsers();
    const userIndex = users.findIndex(u => u.name.toLowerCase() === name.toLowerCase());

    if (userIndex === -1) {
      return res.status(404).json({ error: `Usuário '${name}' não encontrado.` });
    }

    const user = users[userIndex];

    // Clear their columns in the Sheets (row 3 to 150)
    const auth = getOAuth2Client();
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.clear({
      spreadsheetId: TASKS_SPREADSHEET_ID,
      range: `'APP '!${user.taskCol}3:${user.obsCol}150`
    });

    // Remove from users list
    users.splice(userIndex, 1);
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));

    res.json({ success: true, message: `Usuário '${name}' excluído com sucesso.` });

  } catch (error) {
    console.error('Erro ao excluir usuário:', error);
    res.status(500).json({ error: 'Erro ao excluir usuário no Sheets: ' + error.message });
  }
});

// Fetch all tasks dynamically for all users
app.get('/api/tasks', async (req, res) => {
  try {
    const users = loadUsers();
    if (users.length === 0) {
      return res.json({});
    }

    // Find highest column index
    let maxColIdx = 3;
    users.forEach(u => {
      if (u.colIdx + 1 > maxColIdx) maxColIdx = u.colIdx + 1;
    });

    const maxColLetter = indexToColumnLetter(maxColIdx);
    const auth = getOAuth2Client();
    const sheets = google.sheets({ version: 'v4', auth });

    // Fetch sheet rows from D1 to MaxColumn150
    const tasksResponse = await sheets.spreadsheets.get({
      spreadsheetId: TASKS_SPREADSHEET_ID,
      ranges: [`'APP '!D1:${maxColLetter}150`],
      fields: "sheets(properties(sheetId),data(rowData(values(userEnteredValue,effectiveValue,formattedValue,effectiveFormat,userEnteredFormat))))"
    });

    const sheetData = tasksResponse.data.sheets[0].data[0];
    const rowData = sheetData.rowData || [];

    const result = {};
    users.forEach(u => {
      result[u.name.toLowerCase()] = [];
    });
    const imagesMap = loadImagesMap();
    const datesMap = loadDatesMap();

    // Helper to safely extract cell details
    const getCellDetail = (values, relIdx) => {
      if (!values || relIdx >= values.length) return { val: '', strikethrough: false };
      const cell = values[relIdx];
      
      let val = '';
      if (cell) {
        if (cell.formattedValue !== undefined) {
          val = cell.formattedValue;
        } else if (cell.effectiveValue && Object.keys(cell.effectiveValue).length > 0) {
          const keys = Object.keys(cell.effectiveValue);
          val = String(cell.effectiveValue[keys[0]]);
        } else if (cell.userEnteredValue && cell.userEnteredValue.formulaValue === undefined) {
          const keys = Object.keys(cell.userEnteredValue);
          if (keys.length > 0) {
            val = String(cell.userEnteredValue[keys[0]]);
          }
        }
      }

      const strikethrough = !!(cell && cell.effectiveFormat && 
                               cell.effectiveFormat.textFormat && 
                               cell.effectiveFormat.textFormat.strikethrough);
      return { val: val.trim(), strikethrough };
    };

    // Parse tasks from row 4 (index 3)
    for (let r_idx = 3; r_idx < rowData.length; r_idx++) {
      const row = rowData[r_idx];
      const values = row.values || [];

      users.forEach(u => {
        // D is index 3 in sheets. Fetch started at D, so D is index 0 in the row array.
        // The relative column index of the task in the fetched data is (u.colIdx - 3)
        const relTaskIdx = u.colIdx - 3;
        const relObsIdx = relTaskIdx + 1;

        const taskData = getCellDetail(values, relTaskIdx);
        const obsData = getCellDetail(values, relObsIdx);

        if (taskData.val) {
          const upperVal = taskData.val.toUpperCase();
          let cleanTask = taskData.val;
          let classification = '';
          
          if (upperVal.startsWith('[URGENTE]')) {
            classification = 'urgente';
            cleanTask = cleanTask.substring(9).trim();
          } else if (upperVal.startsWith('[SEMANAL]')) {
            classification = 'semanal';
            cleanTask = cleanTask.substring(9).trim();
          } else if (upperVal.startsWith('[MENSAL]')) {
            classification = 'mensal';
            cleanTask = cleanTask.substring(8).trim();
          }

          const taskKey = getTaskKey(u.name, cleanTask);
          
          // Normalize attachments representation (backward compatibility)
          let attachments = [];
          if (imagesMap[taskKey]) {
            if (Array.isArray(imagesMap[taskKey])) {
              attachments = imagesMap[taskKey];
            } else {
              attachments = [{
                filename: imagesMap[taskKey],
                originalName: imagesMap[taskKey],
                mimeType: imagesMap[taskKey].endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'
              }];
            }
          }

          result[u.name.toLowerCase()].push({
            row: r_idx + 1,
            task: cleanTask,
            classification: classification,
            observation: obsData.val,
            completed: taskData.strikethrough,
            imageUrl: attachments.length > 0 ? `/uploads/${attachments[0].filename}` : null,
            attachments: attachments,
            date: datesMap[taskKey] || null
          });
        }
      });
    }

    res.json(result);

  } catch (error) {
    console.error('Erro ao buscar tarefas:', error);
    res.status(500).json({ error: 'Erro ao obter tarefas da planilha: ' + error.message });
  }
});

// Fetch Aviamentos from external spreadsheet
app.get('/api/aviamentos', async (req, res) => {
  try {
    const auth = getOAuth2Client();
    const sheets = google.sheets({ version: 'v4', auth });
    
    const spreadsheetId = '1aAsiicOY0vu5MgQjeeBCsqcAZwGn3JQmj8drYrVaZtc';
    
    // Get spreadsheet info to find the exact sheet title using GID
    const info = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = info.data.sheets.find(s => s.properties.sheetId === 558981201);
    
    if (!sheet) {
      return res.json([]);
    }
    
    const title = sheet.properties.title;
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${title}'!H2:L1000`
    });
    
    const rows = response.data.values || [];
    const aviamentos = [];
    
    rows.forEach(row => {
      // H=0 (Previsao), I=1 (Resp), J=2 (Forn), K=3 (Prod), L=4 (Desc)
      const dateRaw = row[0] || '';
      if (!dateRaw || dateRaw === '-' || dateRaw.trim() === '') return;
      
      // Parse DD/MM/YYYY into YYYY-MM-DD
      let isoDate = dateRaw;
      if (dateRaw.includes('/')) {
        const parts = dateRaw.split('/');
        if (parts.length === 3) {
          let y = parts[2].trim();
          let m = parts[1].trim().padStart(2, '0');
          let d = parts[0].trim().padStart(2, '0');
          // Handle short year like '26' instead of '2026' if needed, though they seem to use 4 digits
          if (y.length === 2) y = '20' + y;
          isoDate = `${y}-${m}-${d}T07:00`;
        }
      }
      
      const resp = row[1] || '';
      const forn = row[2] || '';
      const prod = row[3] || '';
      const desc = row[4] || '';
      
      let titleText = `📦 Aviamento: ${desc}`;
      if (prod) titleText += ` (${prod})`;
      if (forn) titleText += ` - Forn: ${forn}`;
      
      aviamentos.push({
        type: 'aviamento',
        date: isoDate,
        personName: resp,
        task: titleText,
        supplier: forn,
        product: prod,
        description: desc
      });
    });
    
    res.json(aviamentos);
  } catch (error) {
    console.error('Erro ao buscar aviamentos:', error);
    res.status(500).json({ error: 'Erro ao obter aviamentos: ' + error.message });
  }
});
app.post('/api/tasks/add', async (req, res) => {
  const { person, task, observation, classification } = req.body;
  if (!person || !task) {
    return res.status(400).json({ error: 'Responsável e pendência são obrigatórios.' });
  }

  try {
    const result = await addTaskToSheet(person, task, observation, classification);
    res.json({
      success: true,
      task: result
    });
  } catch (error) {
    console.error('Erro ao adicionar tarefa no topo:', error);
    res.status(500).json({ error: 'Erro ao salvar nova pendência no topo: ' + error.message });
  }
});

async function addTaskToSheet(person, task, observation, classification) {

  try {
    const users = loadUsers();
    const user = users.find(u => u.name.toLowerCase() === person.toLowerCase());
    
    if (!user) {
      throw new Error(`Usuário '${person}' não cadastrado.`);
    }

    const auth = getOAuth2Client();
    const sheets = google.sheets({ version: 'v4', auth });

    // Fetch all sheet columns to locate and get full cell metadata for the user
    let maxColIdx = 3;
    users.forEach(u => {
      if (u.colIdx + 1 > maxColIdx) maxColIdx = u.colIdx + 1;
    });
    const maxColLetter = indexToColumnLetter(maxColIdx);

    const tasksResponse = await sheets.spreadsheets.get({
      spreadsheetId: TASKS_SPREADSHEET_ID,
      ranges: [`'APP '!D1:${maxColLetter}150`],
      fields: "sheets(properties(sheetId),data(rowData(values(userEnteredValue,effectiveValue,formattedValue,effectiveFormat,userEnteredFormat))))"
    });

    const sheet = tasksResponse.data.sheets[0];
    const sheetId = sheet.properties.sheetId;
    const rowData = sheet.data[0].rowData || [];

    const relTaskIdx = user.colIdx - 3;
    const relObsIdx = relTaskIdx + 1;

    // Load current cells from row 4 (index 3) to 150
    const userCells = [];
    const maxRows = 150;
    for (let r = 3; r < maxRows; r++) {
      const row = rowData[r] || {};
      const values = row.values || [];
      const taskCell = values[relTaskIdx] || {};
      const obsCell = values[relObsIdx] || {};
      userCells.push({
        taskCell: taskCell,
        obsCell: obsCell
      });
    }

    // Prepare new cells for insertion at index 0 (row 4)
    let finalTaskText = task;
    if (classification === 'urgente') finalTaskText = `[URGENTE] ${task}`;
    else if (classification === 'semanal') finalTaskText = `[SEMANAL] ${task}`;
    else if (classification === 'mensal') finalTaskText = `[MENSAL] ${task}`;

    const newTaskCell = {
      userEnteredValue: { stringValue: finalTaskText }
    };

    const newObsCell = {
      userEnteredValue: { stringValue: observation || "" }
    };

    // If classification is urgent, insert at index 0 (row 4)
    // Otherwise, insert below any existing urgent tasks
    let insertIndex = 0;
    if (classification !== 'urgente') {
      for (let i = 0; i < userCells.length; i++) {
        const cell = userCells[i].taskCell;
        let val = '';
        if (cell) {
          if (cell.formattedValue !== undefined) val = cell.formattedValue;
          else if (cell.userEnteredValue && cell.userEnteredValue.stringValue !== undefined) {
            val = cell.userEnteredValue.stringValue;
          }
        }
        val = val.trim();
        if (val.toUpperCase().startsWith('[URGENTE]')) {
          insertIndex = i + 1;
        } else {
          break;
        }
      }
    }

    userCells.splice(insertIndex, 0, {
      taskCell: newTaskCell,
      obsCell: newObsCell
    });

    // Keep only up to 147 rows to avoid expanding past row 150
    if (userCells.length > 147) {
      userCells.length = 147;
    }

    // Build row data for updateCells
    const rows = [];
    for (let i = 0; i < userCells.length; i++) {
      const cellObj = userCells[i];
      const taskData = {};
      const obsData = {};

      if (cellObj.taskCell.userEnteredValue) {
        taskData.userEnteredValue = cellObj.taskCell.userEnteredValue;
      } else {
        taskData.userEnteredValue = { stringValue: "" };
      }

      if (cellObj.taskCell.userEnteredFormat) {
        taskData.userEnteredFormat = cellObj.taskCell.userEnteredFormat;
      } else if (cellObj.taskCell.effectiveFormat) {
        taskData.userEnteredFormat = cellObj.taskCell.effectiveFormat;
      }

      if (cellObj.obsCell.userEnteredValue) {
        obsData.userEnteredValue = cellObj.obsCell.userEnteredValue;
      } else {
        obsData.userEnteredValue = { stringValue: "" };
      }

      if (cellObj.obsCell.userEnteredFormat) {
        obsData.userEnteredFormat = cellObj.obsCell.userEnteredFormat;
      } else if (cellObj.obsCell.effectiveFormat) {
        obsData.userEnteredFormat = cellObj.obsCell.effectiveFormat;
      }

      rows.push({
        values: [taskData, obsData]
      });
    }

    // Write back to sheet using updateCells in batchUpdate
    const updateRequest = {
      spreadsheetId: TASKS_SPREADSHEET_ID,
      resource: {
        requests: [
          {
            updateCells: {
              rows: rows,
              fields: "userEnteredValue,userEnteredFormat",
              range: {
                sheetId: sheetId,
                startRowIndex: 3,
                endRowIndex: 3 + userCells.length,
                startColumnIndex: user.colIdx,
                endColumnIndex: user.colIdx + 2
              }
            }
          }
        ]
      }
    };

    await sheets.spreadsheets.batchUpdate(updateRequest);

    return {
      row: 4 + insertIndex,
      task,
      classification: classification || '',
      observation: observation || '',
      completed: false
    };
  } catch (error) {
    console.error('Erro no addTaskToSheet:', error);
    throw error;
  }
}

// Classify Task (read current value from sheet, parse, apply prefix, and save)
app.post('/api/tasks/classify', async (req, res) => {
  const { row, person, classification } = req.body;

  if (!row || !person || classification === undefined) {
    return res.status(400).json({ error: 'Linha, responsável e classificação são obrigatórios.' });
  }

  try {
    const users = loadUsers();
    const user = users.find(u => u.name.toLowerCase() === person.toLowerCase());
    
    if (!user) {
      return res.status(400).json({ error: `Usuário '${person}' não encontrado.` });
    }

    const auth = getOAuth2Client();
    const sheets = google.sheets({ version: 'v4', auth });

    // Fetch the current task cell from the sheet first (spreadsheet has priority!)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: TASKS_SPREADSHEET_ID,
      range: `'APP '!${user.taskCol}${row}`
    });

    const cellValues = response.data.values;
    let currentText = '';
    if (cellValues && cellValues.length > 0 && cellValues[0].length > 0) {
      currentText = cellValues[0][0] || '';
    }

    // Strip any existing prefix
    let cleanText = currentText;
    const upperText = currentText.toUpperCase();
    if (upperText.startsWith('[URGENTE]')) {
      cleanText = currentText.substring(9).trim();
    } else if (upperText.startsWith('[SEMANAL]')) {
      cleanText = currentText.substring(9).trim();
    } else if (upperText.startsWith('[MENSAL]')) {
      cleanText = currentText.substring(8).trim();
    } else {
      cleanText = currentText.trim();
    }

    // Prepend the new prefix
    let finalTaskText = cleanText;
    if (classification === 'urgente') finalTaskText = `[URGENTE] ${cleanText}`;
    else if (classification === 'semanal') finalTaskText = `[SEMANAL] ${cleanText}`;
    else if (classification === 'mensal') finalTaskText = `[MENSAL] ${cleanText}`;

    if (classification === 'urgente') {
      // Fetch all sheet columns to locate and get full cell metadata for the user
      let maxColIdx = 3;
      users.forEach(u => {
        if (u.colIdx + 1 > maxColIdx) maxColIdx = u.colIdx + 1;
      });
      const maxColLetter = indexToColumnLetter(maxColIdx);

      const tasksResponse = await sheets.spreadsheets.get({
        spreadsheetId: TASKS_SPREADSHEET_ID,
        ranges: [`'APP '!D1:${maxColLetter}150`],
        fields: "sheets(properties(sheetId),data(rowData(values(userEnteredValue,effectiveValue,formattedValue,effectiveFormat,userEnteredFormat))))"
      });

      const sheet = tasksResponse.data.sheets[0];
      const sheetId = sheet.properties.sheetId;
      const rowData = sheet.data[0].rowData || [];

      const relTaskIdx = user.colIdx - 3;
      const relObsIdx = relTaskIdx + 1;

      // Load current cells from row 4 (index 3) to 150
      const userCells = [];
      const maxRows = 150;
      for (let r = 3; r < maxRows; r++) {
        const rowVal = rowData[r] || {};
        const values = rowVal.values || [];
        const taskCell = values[relTaskIdx] || {};
        const obsCell = values[relObsIdx] || {};
        userCells.push({
          taskCell: taskCell,
          obsCell: obsCell
        });
      }

      const targetIdx = row - 4;
      if (targetIdx >= 0 && targetIdx < userCells.length) {
        const [movedItem] = userCells.splice(targetIdx, 1);
        
        // Update its value with finalTaskText
        movedItem.taskCell.userEnteredValue = { stringValue: finalTaskText };
        
        // Insert at the beginning
        userCells.unshift(movedItem);

        // Keep up to 147 rows
        if (userCells.length > 147) {
          userCells.length = 147;
        }

        // Build row data for updateCells
        const rows = [];
        for (let i = 0; i < userCells.length; i++) {
          const cellObj = userCells[i];
          const taskData = {};
          const obsData = {};

          if (cellObj.taskCell.userEnteredValue) {
            taskData.userEnteredValue = cellObj.taskCell.userEnteredValue;
          } else {
            taskData.userEnteredValue = { stringValue: "" };
          }

          if (cellObj.taskCell.userEnteredFormat) {
            taskData.userEnteredFormat = cellObj.taskCell.userEnteredFormat;
          } else if (cellObj.taskCell.effectiveFormat) {
            taskData.userEnteredFormat = cellObj.taskCell.effectiveFormat;
          }

          if (cellObj.obsCell.userEnteredValue) {
            obsData.userEnteredValue = cellObj.obsCell.userEnteredValue;
          } else {
            obsData.userEnteredValue = { stringValue: "" };
          }

          if (cellObj.obsCell.userEnteredFormat) {
            obsData.userEnteredFormat = cellObj.obsCell.userEnteredFormat;
          } else if (cellObj.obsCell.effectiveFormat) {
            obsData.userEnteredFormat = cellObj.obsCell.effectiveFormat;
          }

          rows.push({
            values: [taskData, obsData]
          });
        }

        const updateRequest = {
          spreadsheetId: TASKS_SPREADSHEET_ID,
          resource: {
            requests: [
              {
                updateCells: {
                  rows: rows,
                  fields: "userEnteredValue,userEnteredFormat",
                  range: {
                    sheetId: sheetId,
                    startRowIndex: 3,
                    endRowIndex: 3 + userCells.length,
                    startColumnIndex: user.colIdx,
                    endColumnIndex: user.colIdx + 2
                  }
                }
              }
            ]
          }
        };

        await sheets.spreadsheets.batchUpdate(updateRequest);
      }
    } else {
      // Write back to sheet (non-urgent prefix change)
      await sheets.spreadsheets.values.update({
        spreadsheetId: TASKS_SPREADSHEET_ID,
        range: `'APP '!${user.taskCol}${row}`,
        valueInputOption: "RAW",
        resource: {
          values: [[finalTaskText]]
        }
      });
    }
    
    res.json({ success: true, message: 'Classificação atualizada.', taskText: finalTaskText });

  } catch (error) {
    console.error('Erro ao classificar tarefa:', error);
    res.status(500).json({ error: 'Erro ao classificar no Sheets: ' + error.message });
  }
});

// Edit Task description (overwrites task text while preserving classification prefix)
app.post('/api/tasks/edit', async (req, res) => {
  const { row, person, task } = req.body;
  if (!row || !person || task === undefined) {
    return res.status(400).json({ error: 'Linha, responsável e novo texto são obrigatórios.' });
  }

  try {
    const users = loadUsers();
    const user = users.find(u => u.name.toLowerCase() === person.toLowerCase());
    if (!user) {
      return res.status(400).json({ error: `Usuário '${person}' não encontrado.` });
    }

    const auth = getOAuth2Client();
    const sheets = google.sheets({ version: 'v4', auth });

    // Fetch the current task cell from the sheet first to see if it had a prefix
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: TASKS_SPREADSHEET_ID,
      range: `'APP '!${user.taskCol}${row}`
    });

    const cellValues = response.data.values;
    let currentText = '';
    if (cellValues && cellValues.length > 0 && cellValues[0].length > 0) {
      currentText = cellValues[0][0] || '';
    }

    // Strip prefix from old text to get old clean text
    let cleanOldText = currentText;
    const upperText = currentText.toUpperCase();
    if (upperText.startsWith('[URGENTE]')) {
      cleanOldText = currentText.substring(9).trim();
    } else if (upperText.startsWith('[SEMANAL]')) {
      cleanOldText = currentText.substring(9).trim();
    } else if (upperText.startsWith('[MENSAL]')) {
      cleanOldText = currentText.substring(8).trim();
    } else {
      cleanOldText = currentText.trim();
    }

    // Check current prefix
    let prefix = '';
    if (upperText.startsWith('[URGENTE]')) prefix = '[URGENTE] ';
    else if (upperText.startsWith('[SEMANAL]')) prefix = '[SEMANAL] ';
    else if (upperText.startsWith('[MENSAL]')) prefix = '[MENSAL] ';

    // Prepend prefix to new task text if the new text is not a formula
    let finalTaskText = task.trim();
    if (prefix && !finalTaskText.startsWith('=')) {
      finalTaskText = prefix + finalTaskText;
    }

    // Update imagesMap and datesMap if the text changed!
    const cleanNewText = task.trim();
    if (cleanOldText !== cleanNewText) {
      const oldKey = getTaskKey(person, cleanOldText);
      const newKey = getTaskKey(person, cleanNewText);

      const imagesMap = loadImagesMap();
      if (imagesMap[oldKey]) {
        imagesMap[newKey] = imagesMap[oldKey];
        delete imagesMap[oldKey];
        saveImagesMap(imagesMap);
      }

      const datesMap = loadDatesMap();
      if (datesMap[oldKey]) {
        datesMap[newKey] = datesMap[oldKey];
        delete datesMap[oldKey];
        saveDatesMap(datesMap);
      }
    }

    // Write back to sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId: TASKS_SPREADSHEET_ID,
      range: `'APP '!${user.taskCol}${row}`,
      valueInputOption: "RAW",
      resource: {
        values: [[finalTaskText]]
      }
    });

    // Sync scheduled dates in the background
    syncCompromissosSheet().catch(e => console.error('Error syncing compromissos:', e));

    res.json({ success: true, message: 'Tarefa editada com sucesso.', taskText: finalTaskText });

  } catch (error) {
    console.error('Erro ao editar tarefa:', error);
    res.status(500).json({ error: 'Erro ao editar no Sheets: ' + error.message });
  }
});

// Update tasks order or delete task (unified endpoint using cells rearrangement in memory)
app.post('/api/tasks/update-order', async (req, res) => {
  const { person, newRowsOrder } = req.body;
  if (!person || !newRowsOrder || !Array.isArray(newRowsOrder)) {
    return res.status(400).json({ error: 'Responsável e nova ordem de linhas são obrigatórios.' });
  }

  try {
    const users = loadUsers();
    const user = users.find(u => u.name.toLowerCase() === person.toLowerCase());
    if (!user) {
      return res.status(400).json({ error: `Usuário '${person}' não encontrado.` });
    }

    const auth = getOAuth2Client();
    const sheets = google.sheets({ version: 'v4', auth });

    // Fetch sheet rows from D1 to MaxColumn150 with full cell metadata
    let maxColIdx = 3;
    users.forEach(u => {
      if (u.colIdx + 1 > maxColIdx) maxColIdx = u.colIdx + 1;
    });
    const maxColLetter = indexToColumnLetter(maxColIdx);

    const tasksResponse = await sheets.spreadsheets.get({
      spreadsheetId: TASKS_SPREADSHEET_ID,
      ranges: [`'APP '!D1:${maxColLetter}150`],
      fields: "sheets(properties(sheetId),data(rowData(values(userEnteredValue,effectiveValue,formattedValue,effectiveFormat,userEnteredFormat))))"
    });

    const sheet = tasksResponse.data.sheets[0];
    const sheetId = sheet.properties.sheetId;
    const rowData = sheet.data[0].rowData || [];

    const relTaskIdx = user.colIdx - 3;
    const relObsIdx = relTaskIdx + 1;

    // Load current cells from row 4 (index 3) to 150
    const userCells = [];
    const maxRows = 150;
    for (let r = 3; r < maxRows; r++) {
      const row = rowData[r] || {};
      const values = row.values || [];
      const taskCell = values[relTaskIdx] || {};
      const obsCell = values[relObsIdx] || {};
      userCells.push({
        row: r + 1,
        taskCell: taskCell,
        obsCell: obsCell
      });
    }

    // Rearrange cells based on the new order of rows
    const rearrangedCells = [];
    newRowsOrder.forEach(rowNum => {
      const cellObj = userCells.find(c => c.row === rowNum);
      if (cellObj) {
        rearrangedCells.push({
          taskCell: cellObj.taskCell,
          obsCell: cellObj.obsCell
        });
      }
    });

    // Pad with empty cells to keep the original length and clear subsequent rows
    while (rearrangedCells.length < userCells.length) {
      rearrangedCells.push({
        taskCell: {},
        obsCell: {}
      });
    }

    // Build the row update requests for updateCells
    const rows = [];
    for (let i = 0; i < userCells.length; i++) {
      const cellObj = rearrangedCells[i];
      const taskData = {};
      const obsData = {};

      // Set userEnteredValue
      if (cellObj.taskCell.userEnteredValue) {
        taskData.userEnteredValue = cellObj.taskCell.userEnteredValue;
      } else {
        taskData.userEnteredValue = { stringValue: "" };
      }

      // Set userEnteredFormat
      if (cellObj.taskCell.userEnteredFormat) {
        taskData.userEnteredFormat = cellObj.taskCell.userEnteredFormat;
      } else if (cellObj.taskCell.effectiveFormat) {
        taskData.userEnteredFormat = cellObj.taskCell.effectiveFormat;
      }

      if (cellObj.obsCell.userEnteredValue) {
        obsData.userEnteredValue = cellObj.obsCell.userEnteredValue;
      } else {
        obsData.userEnteredValue = { stringValue: "" };
      }

      if (cellObj.obsCell.userEnteredFormat) {
        obsData.userEnteredFormat = cellObj.obsCell.userEnteredFormat;
      } else if (cellObj.obsCell.effectiveFormat) {
        obsData.userEnteredFormat = cellObj.obsCell.effectiveFormat;
      }

      rows.push({
        values: [taskData, obsData]
      });
    }

    // Update cells using batchUpdate
    const updateRequest = {
      spreadsheetId: TASKS_SPREADSHEET_ID,
      resource: {
        requests: [
          {
            updateCells: {
              rows: rows,
              fields: "userEnteredValue,userEnteredFormat",
              range: {
                sheetId: sheetId,
                startRowIndex: 3,
                endRowIndex: 3 + userCells.length,
                startColumnIndex: user.colIdx,
                endColumnIndex: user.colIdx + 2
              }
            }
          }
        ]
      }
    };

    await sheets.spreadsheets.batchUpdate(updateRequest);

    // Sync scheduled dates in the background
    syncCompromissosSheet().catch(e => console.error('Error syncing compromissos:', e));

    res.json({ success: true, message: 'Ordem e tarefas atualizadas com sucesso.' });

  } catch (error) {
    console.error('Erro ao atualizar ordem/tarefas:', error);
    res.status(500).json({ error: 'Erro ao atualizar no Sheets: ' + error.message });
  }
});

// Toggle Task Completion
app.post('/api/tasks/toggle', async (req, res) => {
  const { row, completed, person } = req.body;
  
  if (!row || !person) {
    return res.status(400).json({ error: 'Linha e responsável são obrigatórios.' });
  }

  try {
    const users = loadUsers();
    const user = users.find(u => u.name.toLowerCase() === person.toLowerCase());
    
    if (!user) {
      return res.status(400).json({ error: `Usuário '${person}' não encontrado.` });
    }

    const auth = getOAuth2Client();
    const sheets = google.sheets({ version: 'v4', auth });

    const request = {
      spreadsheetId: TASKS_SPREADSHEET_ID,
      resource: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: 0,
                startRowIndex: row - 1,
                endRowIndex: row,
                startColumnIndex: user.colIdx,
                endColumnIndex: user.colIdx + 1
              },
              cell: {
                userEnteredFormat: {
                  textFormat: {
                    strikethrough: completed
                  },
                  backgroundColor: completed ? 
                    { red: 0.9, green: 0.9, blue: 0.9 } : 
                    { red: 1.0, green: 1.0, blue: 1.0 }
                }
              },
              fields: "userEnteredFormat(textFormat(strikethrough),backgroundColor)"
            }
          }
        ]
      }
    };

    await sheets.spreadsheets.batchUpdate(request);
    
    // Sync scheduled dates in the background
    syncCompromissosSheet().catch(e => console.error('Error syncing compromissos:', e));

    res.json({ success: true, message: 'Status da tarefa atualizado com sucesso.' });

  } catch (error) {
    console.error('Erro no toggle de tarefa:', error);
    res.status(500).json({ error: 'Erro ao salvar no Sheets: ' + error.message });
  }
});

// Update Observation
app.post('/api/tasks/observation', async (req, res) => {
  const { row, observation, person } = req.body;

  if (!row || !person) {
    return res.status(400).json({ error: 'Linha e responsável são obrigatórios.' });
  }

  try {
    const users = loadUsers();
    const user = users.find(u => u.name.toLowerCase() === person.toLowerCase());
    
    if (!user) {
      return res.status(400).json({ error: `Usuário '${person}' não encontrado.` });
    }

    const auth = getOAuth2Client();
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.update({
      spreadsheetId: TASKS_SPREADSHEET_ID,
      range: `'APP '!${user.obsCol}${row}`,
      valueInputOption: "RAW",
      resource: {
        values: [[observation || ""]]
      }
    });
    
    res.json({ success: true, message: 'Observação da tarefa salva.' });

  } catch (error) {
    console.error('Erro ao salvar observação:', error);
    res.status(500).json({ error: 'Erro ao salvar observação: ' + error.message });
  }
});

let localtunnelUrl = '';

function startLocaltunnel() {
  console.log('Iniciando túnel para acesso celular externo...');
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const lt = spawn(cmd, ['-y', 'localtunnel', '--port', PORT], { shell: true });

  lt.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`[Localtunnel Log]: ${output.trim()}`);
    const match = output.match(/your url is: (https:\/\/[a-zA-Z0-9.-]+\.loca\.lt)/);
    if (match) {
      localtunnelUrl = match[1];
      console.log(`>>> TÚNEL ATIVO: Acesse no celular em: ${localtunnelUrl}`);
    }
  });

  lt.stderr.on('data', (data) => {
    console.error(`[Localtunnel Error]: ${data.toString()}`);
  });

  lt.on('close', (code) => {
    console.log(`Processo do localtunnel encerrado com código ${code}. Reiniciando em 5 segundos...`);
    setTimeout(startLocaltunnel, 5000);
  });
}

// Helper to get local IP address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    const addresses = interfaces[interfaceName];
    for (const address of addresses) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }
  return '127.0.0.1';
}

// Image/Document Upload Endpoint (Supports multiple attachments)
app.post('/api/tasks/image/upload', async (req, res) => {
  const { person, task, imageBase64, mimeType, originalName } = req.body;
  if (!person || !task || !imageBase64) {
    return res.status(400).json({ error: 'Responsável, pendência e Base64 do arquivo são obrigatórios.' });
  }

  try {
    const cleanBase64 = imageBase64.replace(/^data:(image\/\w+|application\/pdf);base64,/, "");
    const buffer = Buffer.from(cleanBase64, 'base64');
    
    // Determine extension from mimeType
    let ext = 'png';
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') ext = 'jpg';
    else if (mimeType === 'image/gif') ext = 'gif';
    else if (mimeType === 'image/webp') ext = 'webp';
    else if (mimeType === 'application/pdf') ext = 'pdf';
    
    // Clean name of any characters not safe for filenames (like slashes or spaces)
    const cleanPerson = person.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const filename = `${cleanPerson}_${Date.now()}.${ext}`;
    const filePath = path.join(__dirname, 'public', 'uploads', filename);
    
    fs.writeFileSync(filePath, buffer);
    
    // Save to mapping
    const imagesMap = loadImagesMap();
    const taskKey = getTaskKey(person, task);
    
    // Normalize current state to an array
    let currentAttachments = [];
    if (imagesMap[taskKey]) {
      if (Array.isArray(imagesMap[taskKey])) {
        currentAttachments = imagesMap[taskKey];
      } else {
        currentAttachments = [{
          filename: imagesMap[taskKey],
          originalName: imagesMap[taskKey],
          mimeType: imagesMap[taskKey].endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'
        }];
      }
    }
    
    const newAttachment = {
      filename: filename,
      originalName: originalName || filename,
      mimeType: mimeType || (mimeType === 'application/pdf' ? 'application/pdf' : 'image/jpeg')
    };
    
    currentAttachments.push(newAttachment);
    imagesMap[taskKey] = currentAttachments;
    saveImagesMap(imagesMap);
    
    res.json({ success: true, attachments: currentAttachments });
  } catch (error) {
    console.error('Erro ao fazer upload da imagem/documento:', error);
    res.status(500).json({ error: 'Erro ao fazer upload da imagem/documento: ' + error.message });
  }
});

// Image/Document Delete Endpoint (Supports deleting specific attachment)
app.post('/api/tasks/image/delete', async (req, res) => {
  const { person, task, filename } = req.body;
  if (!person || !task) {
    return res.status(400).json({ error: 'Responsável e pendência são obrigatórios.' });
  }

  try {
    const imagesMap = loadImagesMap();
    const taskKey = getTaskKey(person, task);
    
    let currentAttachments = [];
    if (imagesMap[taskKey]) {
      if (Array.isArray(imagesMap[taskKey])) {
        currentAttachments = imagesMap[taskKey];
      } else {
        currentAttachments = [{
          filename: imagesMap[taskKey],
          originalName: imagesMap[taskKey],
          mimeType: imagesMap[taskKey].endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'
        }];
      }
    }
    
    if (filename) {
      // Find the specific attachment to delete
      const targetIdx = currentAttachments.findIndex(att => att.filename === filename);
      if (targetIdx !== -1) {
        const targetFilename = currentAttachments[targetIdx].filename;
        const filePath = path.join(__dirname, 'public', 'uploads', targetFilename);
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (e) {}
        }
        currentAttachments.splice(targetIdx, 1);
      }
    } else {
      // If no specific filename, delete all files of this task
      currentAttachments.forEach(att => {
        const filePath = path.join(__dirname, 'public', 'uploads', att.filename);
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (e) {}
        }
      });
      currentAttachments = [];
    }
    
    if (currentAttachments.length > 0) {
      imagesMap[taskKey] = currentAttachments;
    } else {
      delete imagesMap[taskKey];
    }
    
    saveImagesMap(imagesMap);
    res.json({ success: true, attachments: currentAttachments });
  } catch (error) {
    console.error('Erro ao deletar imagem:', error);
    res.status(500).json({ error: 'Erro ao deletar imagem: ' + error.message });
  }
});

// Save Task Date Scheduling Endpoint
app.post('/api/tasks/date/save', async (req, res) => {
  const { person, task, date } = req.body;
  if (!person || !task || !date) {
    return res.status(400).json({ error: 'Responsável, pendência e data são obrigatórios.' });
  }

  try {
    const datesMap = loadDatesMap();
    const taskKey = getTaskKey(person, task);
    datesMap[taskKey] = date;
    saveDatesMap(datesMap);
    
    // Sync scheduled dates in the background
    syncCompromissosSheet().catch(e => console.error('Error syncing compromissos:', e));

    res.json({ success: true, date });
  } catch (error) {
    console.error('Erro ao agendar data:', error);
    res.status(500).json({ error: 'Erro ao agendar data: ' + error.message });
  }
});

// Delete Task Date Scheduling Endpoint
app.post('/api/tasks/date/delete', async (req, res) => {
  const { person, task } = req.body;
  if (!person || !task) {
    return res.status(400).json({ error: 'Responsável e pendência são obrigatórios.' });
  }

  try {
    const datesMap = loadDatesMap();
    const taskKey = getTaskKey(person, task);
    if (datesMap[taskKey]) {
      delete datesMap[taskKey];
      saveDatesMap(datesMap);
    }
    
    // Sync scheduled dates in the background
    syncCompromissosSheet().catch(e => console.error('Error syncing compromissos:', e));

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover data agendada:', error);
    res.status(500).json({ error: 'Erro ao remover data agendada: ' + error.message });
  }
});

// Process Tarefas Futuras
async function processFutureTasks() {
  try {
    const auth = getOAuth2Client();
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Read TAREFAS FUTURAS!B2:G
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: TASKS_SPREADSHEET_ID,
      range: "'TAREFAS FUTURAS'!B2:G"
    });
    const rows = response.data.values || [];
    const now = new Date(); // Global current time
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // B=0(USER), C=1(TASK), D=2(DATE), E=3(TIME), F=4(URGENT), G=5(STATUS)
      const user = row[0] || '';
      const taskText = row[1] || '';
      const dateStr = row[2] || '';
      const timeStr = row[3] || '07:00:00';
      const urgentStr = row[4] || '';
      const status = row[5] || '';
      
      if (!user || !taskText || !dateStr || status === 'ENVIADO') continue;
      
      // dateStr usually is DD/MM/YYYY
      let isoDateStr = '';
      if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          let y = parts[2].trim();
          if (y.length === 2) y = '20' + y;
          const m = parts[1].trim().padStart(2, '0');
          const d = parts[0].trim().padStart(2, '0');
          // timeStr is HH:MM:SS or HH:MM
          let t = timeStr.trim();
          if (t.length <= 5) t += ':00'; 
          isoDateStr = `${y}-${m}-${d}T${t}-03:00`;
        }
      } else {
        continue;
      }
      
      const taskTime = new Date(isoDateStr);
      
      // If task time is valid and has passed or is now
      if (!isNaN(taskTime.getTime()) && taskTime <= now) {
        const classification = urgentStr.toUpperCase() === 'SIM' ? 'urgente' : '';
        
        try {
          await addTaskToSheet(user, taskText, '', classification);
          
          // Mark as ENVIADO
          await sheets.spreadsheets.values.update({
            spreadsheetId: TASKS_SPREADSHEET_ID,
            range: `'TAREFAS FUTURAS'!G${i + 2}`,
            valueInputOption: "RAW",
            resource: {
              values: [['ENVIADO']]
            }
          });
          console.log(`Tarefa Futura "${taskText}" processada para ${user}.`);
        } catch (e) {
          console.error(`Falha ao enviar tarefa futura para ${user}:`, e.message);
        }
      }
    }
  } catch (err) {
    console.error('Erro ao processar tarefas futuras:', err);
  }
}

// Run every 1 minute
setInterval(processFutureTasks, 60000);

// Endpoint for frontend to see pending future tasks
app.get('/api/tarefas-futuras', async (req, res) => {
  try {
    const auth = getOAuth2Client();
    const sheets = google.sheets({ version: 'v4', auth });
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: TASKS_SPREADSHEET_ID,
      range: "'TAREFAS FUTURAS'!B2:G"
    });
    
    const rows = response.data.values || [];
    const pending = [];
    
    rows.forEach((row, idx) => {
      const user = row[0] || '';
      const taskText = row[1] || '';
      const dateStr = row[2] || '';
      const timeStr = row[3] || '';
      const urgentStr = row[4] || '';
      const status = row[5] || '';
      
      if (!user || !taskText || !dateStr || status === 'ENVIADO') return;
      
      pending.push({
        row: idx + 2,
        user,
        task: taskText,
        date: dateStr,
        time: timeStr,
        urgente: urgentStr.toUpperCase() === 'SIM'
      });
    });
    
    res.json(pending);
  } catch (error) {
    console.error('Erro ao buscar tarefas futuras:', error);
    res.status(500).json({ error: 'Erro ao buscar tarefas futuras: ' + error.message });
  }
});

// Info endpoint for mobile access
app.get('/api/info', (req, res) => {
  const ip = getLocalIpAddress();
  res.json({
    localIp: ip,
    port: PORT,
    localUrl: `http://${ip}:${PORT}`,
    tunnelUrl: localtunnelUrl || `http://${ip}:${PORT}`
  });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIpAddress();
  console.log(`GT App rodando localmente em: http://localhost:${PORT}`);
  console.log(`Acesse no celular pela rede local em: http://${ip}:${PORT}`);
  
  // Start localtunnel in background
  startLocaltunnel();
});
