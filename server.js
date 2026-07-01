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
app.use(express.json());

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

          result[u.name.toLowerCase()].push({
            row: r_idx + 1,
            task: cleanTask,
            classification: classification,
            observation: obsData.val,
            completed: taskData.strikethrough
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

// Add a new task (append to the end of the user's list)
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

    // Fetch the task column to locate the last non-empty row
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: TASKS_SPREADSHEET_ID,
      range: `'APP '!${user.taskCol}1:${user.taskCol}150`
    });

    const rows = response.data.values || [];
    
    // Find the last row with non-empty text
    let lastFilledRow = 3; // headers are on row 3
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i] && rows[i][0] && rows[i][0].trim()) {
        lastFilledRow = i + 1;
        break;
      }
    }

    const newRow = lastFilledRow + 1;

    // Prep classification prefix
    let finalTaskText = task;
    if (classification === 'urgente') finalTaskText = `[URGENTE] ${task}`;
    else if (classification === 'semanal') finalTaskText = `[SEMANAL] ${task}`;
    else if (classification === 'mensal') finalTaskText = `[MENSAL] ${task}`;

    // Write task to taskCol and observation to obsCol
    await sheets.spreadsheets.values.update({
      spreadsheetId: TASKS_SPREADSHEET_ID,
      range: `'APP '!${user.taskCol}${newRow}`,
      valueInputOption: "RAW",
      resource: {
        values: [[finalTaskText]]
      }
    });

    if (observation) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: TASKS_SPREADSHEET_ID,
        range: `'APP '!${user.obsCol}${newRow}`,
        valueInputOption: "RAW",
        resource: {
          values: [[observation]]
        }
      });
    }

    res.json({
      success: true,
      task: {
        row: newRow,
        task,
        classification: classification || '',
        observation: observation || '',
        completed: false
      }
    });
  } catch (error) {
    console.error('Erro ao adicionar tarefa:', error);
    res.status(500).json({ error: 'Erro ao salvar nova pendência: ' + error.message });
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

    // Write back to sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId: TASKS_SPREADSHEET_ID,
      range: `'APP '!${user.taskCol}${row}`,
      valueInputOption: "RAW",
      resource: {
        values: [[finalTaskText]]
      }
    });
    
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

    // Check current prefix
    let prefix = '';
    const upperText = currentText.toUpperCase();
    if (upperText.startsWith('[URGENTE]')) prefix = '[URGENTE] ';
    else if (upperText.startsWith('[SEMANAL]')) prefix = '[SEMANAL] ';
    else if (upperText.startsWith('[MENSAL]')) prefix = '[MENSAL] ';

    // Prepend prefix to new task text if the new text is not a formula
    let finalTaskText = task.trim();
    if (prefix && !finalTaskText.startsWith('=')) {
      finalTaskText = prefix + finalTaskText;
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
