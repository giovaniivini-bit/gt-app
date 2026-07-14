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
          const imageUrl = imagesMap[taskKey] ? `/uploads/${imagesMap[taskKey]}` : null;

          result[u.name.toLowerCase()].push({
            row: r_idx + 1,
            task: cleanTask,
            classification: classification,
            observation: obsData.val,
            completed: taskData.strikethrough,
            imageUrl: imageUrl
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
app.post('/api/tasks/add', async (req, res) => {
  const { person, task, observation, classification } = req.body;
  if (!person || !task) {
    return res.status(400).json({ error: 'Responsável e pendência são obrigatórios.' });
  }

  try {
    const users = loadUsers();
    const user = users.find(u => u.name.toLowerCase() === person.toLowerCase());
    
    if (!user) {
      return res.status(400).json({ error: `Usuário '${person}' não cadastrado.` });
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

    res.json({
      success: true,
      task: {
        row: 4 + insertIndex,
        task,
        classification: classification || '',
        observation: observation || '',
        completed: false
      }
    });

  } catch (error) {
    console.error('Erro ao adicionar tarefa no topo:', error);
    res.status(500).json({ error: 'Erro ao salvar nova pendência no topo: ' + error.message });
  }
});

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

    // Update imagesMap if the text changed!
    const cleanNewText = task.trim();
    if (cleanOldText !== cleanNewText) {
      const imagesMap = loadImagesMap();
      const oldKey = getTaskKey(person, cleanOldText);
      const newKey = getTaskKey(person, cleanNewText);
      
      if (imagesMap[oldKey]) {
        imagesMap[newKey] = imagesMap[oldKey];
        delete imagesMap[oldKey];
        saveImagesMap(imagesMap);
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

// Image Upload Endpoint (Receives base64 encoded image)
app.post('/api/tasks/image/upload', async (req, res) => {
  const { person, task, imageBase64, mimeType } = req.body;
  if (!person || !task || !imageBase64) {
    return res.status(400).json({ error: 'Responsável, pendência e imagem em Base64 são obrigatórios.' });
  }

  try {
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, 'base64');
    
    // Determine extension from mimeType
    let ext = 'png';
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') ext = 'jpg';
    else if (mimeType === 'image/gif') ext = 'gif';
    else if (mimeType === 'image/webp') ext = 'webp';
    
    // Clean name of any characters not safe for filenames (like slashes or spaces)
    const cleanPerson = person.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const filename = `${cleanPerson}_${Date.now()}.${ext}`;
    const filePath = path.join(__dirname, 'public', 'uploads', filename);
    
    fs.writeFileSync(filePath, buffer);
    
    // Save to mapping
    const imagesMap = loadImagesMap();
    const taskKey = getTaskKey(person, task);
    
    // If there was an old image, delete the old file
    if (imagesMap[taskKey]) {
      const oldFilePath = path.join(__dirname, 'public', 'uploads', imagesMap[taskKey]);
      if (fs.existsSync(oldFilePath)) {
        try { fs.unlinkSync(oldFilePath); } catch (e) {}
      }
    }
    
    imagesMap[taskKey] = filename;
    saveImagesMap(imagesMap);
    
    res.json({ success: true, imageUrl: `/uploads/${filename}` });
  } catch (error) {
    console.error('Erro ao fazer upload da imagem:', error);
    res.status(500).json({ error: 'Erro ao fazer upload da imagem: ' + error.message });
  }
});

// Image Delete Endpoint
app.post('/api/tasks/image/delete', async (req, res) => {
  const { person, task } = req.body;
  if (!person || !task) {
    return res.status(400).json({ error: 'Responsável e pendência são obrigatórios.' });
  }

  try {
    const imagesMap = loadImagesMap();
    const taskKey = getTaskKey(person, task);
    
    if (imagesMap[taskKey]) {
      const filePath = path.join(__dirname, 'public', 'uploads', imagesMap[taskKey]);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
      delete imagesMap[taskKey];
      saveImagesMap(imagesMap);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar imagem:', error);
    res.status(500).json({ error: 'Erro ao deletar imagem: ' + error.message });
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
