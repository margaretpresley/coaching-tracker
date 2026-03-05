// ============================================================
// MICRO COACHING TRACKER - Google Apps Script Backend
// Deploy as Web App: Execute as Me, Anyone can access
// ============================================================

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

const SHEETS = {
  TEACHERS:     'Teachers',
  OBSERVATIONS: 'Observations'
};

// ── Main router ──────────────────────────────────────────────
function doGet(e) {
  const action = e.parameter.action;
  let result;
  try {
    switch (action) {
      case 'getAll':      result = getAllData();      break;
      case 'getTeachers': result = getTeachers();    break;
      case 'getObs':      result = getObservations(); break;
      default:            result = { error: 'Unknown action' };
    }
  } catch (err) {
    result = { error: err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const action = body.action;
  let result;
  try {
    switch (action) {
      case 'saveTeacher':      result = saveTeacher(body.data);      break;
      case 'updateTeacher':    result = updateTeacher(body.data);    break;
      case 'deleteTeacher':    result = deleteTeacher(body.id);      break;
      case 'saveObservation':  result = saveObservation(body.data);  break;
      case 'updateObservation': result = updateObservation(body.data); break;
      case 'claudeProxy':      result = claudeProxy(body.prompt, body.maxTokens); break;
      default:                 result = { error: 'Unknown action' };
    }
  } catch (err) {
    result = { error: err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Sheet Setup ───────────────────────────────────────────────
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Teachers sheet
  let ts = ss.getSheetByName(SHEETS.TEACHERS);
  if (!ts) {
    ts = ss.insertSheet(SHEETS.TEACHERS);
    ts.appendRow([
      'id', 'name', 'greeting', 'gradeBand', 'primaryCoach', 'currentGoal',
      'email', 'room',
      'availabilityStart', 'availabilityEnd',  // legacy — kept for compatibility
      'availabilityWindows',                    // NEW: JSON array of {start,end} objects
      'availableDays', 'status', 'createdAt'
    ]);
    ts.setFrozenRows(1);
    ts.getRange(1, 1, 1, 14).setFontWeight('bold').setBackground('#4F46E5').setFontColor('#FFFFFF');
    ts.setColumnWidth(1,  160); // id
    ts.setColumnWidth(2,  160); // name
    ts.setColumnWidth(3,   60); // greeting
    ts.setColumnWidth(4,  120); // gradeBand
    ts.setColumnWidth(5,  120); // primaryCoach
    ts.setColumnWidth(6,   80); // currentGoal
    ts.setColumnWidth(7,  200); // email
    ts.setColumnWidth(8,   80); // room
    ts.setColumnWidth(9,  120); // availabilityStart
    ts.setColumnWidth(10, 120); // availabilityEnd
    ts.setColumnWidth(11, 300); // availabilityWindows
    ts.setColumnWidth(12, 200); // availableDays
    ts.setColumnWidth(13,  80); // status
    ts.setColumnWidth(14, 160); // createdAt
  } else {
    // Add availabilityWindows column if it doesn't exist yet
    const headers = ts.getRange(1, 1, 1, ts.getLastColumn()).getValues()[0];
    if (!headers.includes('availabilityWindows')) {
      const insertCol = headers.length + 1;
      ts.getRange(1, insertCol).setValue('availabilityWindows');
      ts.getRange(1, insertCol).setFontWeight('bold').setBackground('#4F46E5').setFontColor('#FFFFFF');
      ts.setColumnWidth(insertCol, 300);
    }
  }

  // Observations sheet
  let os = ss.getSheetByName(SHEETS.OBSERVATIONS);
  if (!os) {
    os = ss.insertSheet(SHEETS.OBSERVATIONS);
    os.appendRow([
      'id', 'teacherId', 'teacherName', 'coach', 'date',
      'goalNumber', 'impression', 'lookForResponses',
      'glow', 'grow', 'coachNotes', 'followUpNeeded',
      'missed', 'createdAt'
    ]);
    os.setFrozenRows(1);
    os.getRange(1, 1, 1, 14).setFontWeight('bold').setBackground('#4F46E5').setFontColor('#FFFFFF');
    os.setColumnWidth(8,  300); // lookForResponses
    os.setColumnWidth(9,  300); // glow
    os.setColumnWidth(10, 300); // grow
    os.setColumnWidth(11, 300); // coachNotes
  }

  return { success: true, message: 'Sheets ready!' };
}

// ── GET functions ─────────────────────────────────────────────
function getAllData() {
  return {
    teachers:     getTeachers(),
    observations: getObservations()
  };
}

function getTeachers() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.TEACHERS);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = rowToObj(headers, row);
    // Parse availabilityWindows from JSON string
    if (obj.availabilityWindows) {
      try {
        obj.availabilityWindows = JSON.parse(obj.availabilityWindows);
      } catch(e) {
        obj.availabilityWindows = [];
      }
    }
    // Migrate legacy single window into availabilityWindows if missing
    if ((!obj.availabilityWindows || !obj.availabilityWindows.length)
        && obj.availabilityStart && obj.availabilityEnd) {
      obj.availabilityWindows = [{ start: obj.availabilityStart, end: obj.availabilityEnd }];
    }
    return obj;
  });
}

function getObservations() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.OBSERVATIONS);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = rowToObj(headers, row);
    try { obj.lookForResponses = JSON.parse(obj.lookForResponses || '{}'); } catch(e) { obj.lookForResponses = {}; }
    obj.followUpNeeded = (obj.followUpNeeded === true || obj.followUpNeeded === 'TRUE');
    obj.missed = (obj.missed === true || obj.missed === 'TRUE');
    return obj;
  });
}

// ── SAVE / UPDATE functions ───────────────────────────────────
function saveTeacher(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.TEACHERS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = buildTeacherRow(data, headers);
  sheet.appendRow(row);
  return { success: true };
}

function updateTeacher(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.TEACHERS);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      const row = buildTeacherRow(data, headers);
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return { success: true };
    }
  }
  return { error: 'Teacher not found' };
}

function deleteTeacher(id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.TEACHERS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { error: 'Teacher not found' };
}

// Build teacher row dynamically from headers so new columns are handled safely
function buildTeacherRow(data, headers) {
  const windows = data.availabilityWindows || [];
  const legacy = windows.length ? windows[0] : {};
  const map = {
    id:                   data.id,
    name:                 data.name || '',
    greeting:             data.greeting || 'Ms.',
    gradeBand:            data.gradeBand || '',
    primaryCoach:         data.primaryCoach || '',
    currentGoal:          data.currentGoal || 1,
    email:                data.email || '',
    room:                 data.room || '',
    availabilityStart:    legacy.start || data.availabilityStart || '',
    availabilityEnd:      legacy.end   || data.availabilityEnd   || '',
    availabilityWindows:  windows.length ? JSON.stringify(windows) : '',
    availableDays:        data.availableDays || 'Mon,Tue,Wed,Thu,Fri',
    status:               data.status || 'active',
    createdAt:            data.createdAt || new Date().toISOString()
  };
  return headers.map(h => (h in map ? map[h] : ''));
}

function saveObservation(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.OBSERVATIONS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = buildObsRow(data, headers);
  sheet.appendRow(row);
  return { success: true };
}

function updateObservation(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.OBSERVATIONS);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      const row = buildObsRow(data, headers);
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return { success: true };
    }
  }
  return { error: 'Observation not found' };
}

function buildObsRow(data, headers) {
  const map = {
    id:                data.id,
    teacherId:         data.teacherId,
    teacherName:       data.teacherName || '',
    coach:             data.coach || '',
    date:              data.date || '',
    goalNumber:        data.goalNumber || 1,
    impression:        data.impression || '',
    lookForResponses:  JSON.stringify(data.lookForResponses || {}),
    glow:              data.glow || '',
    grow:              data.grow || '',
    coachNotes:        data.coachNotes || '',
    followUpNeeded:    data.followUpNeeded ? 'TRUE' : 'FALSE',
    missed:            data.missed ? 'TRUE' : 'FALSE',
    createdAt:         data.createdAt || new Date().toISOString()
  };
  return headers.map(h => (h in map ? map[h] : ''));
}

// ── Utility ───────────────────────────────────────────────────
function formatTimeValue(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date) {
    const h = val.getHours();
    const m = val.getMinutes();
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  }
  if (typeof val === 'number') {
    const totalMins = Math.round(val * 24 * 60);
    const h = Math.floor(totalMins / 60) % 24;
    const m = totalMins % 60;
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  }
  if (typeof val === 'string' && val.indexOf(':') !== -1) {
    const parts = val.split(':');
    const h = parseInt(parts[0]);
    const m = parseInt(parts[1]);
    if (!isNaN(h) && !isNaN(m)) {
      return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
    }
  }
  return String(val);
}

function formatDateValue(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  return String(val).split('T')[0].trim();
}

function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i]; });
  if ('availabilityStart' in obj) obj.availabilityStart = formatTimeValue(obj.availabilityStart);
  if ('availabilityEnd'   in obj) obj.availabilityEnd   = formatTimeValue(obj.availabilityEnd);
  if ('date'      in obj) obj.date      = formatDateValue(obj.date);
  if ('visitDate' in obj) obj.visitDate = formatDateValue(obj.visitDate);
  if ('createdAt' in obj && obj.createdAt instanceof Date) obj.createdAt = obj.createdAt.toISOString();
  return obj;
}


// ── Claude AI Proxy ───────────────────────────────────────────────────────────
// Store your Anthropic API key in Apps Script:
//   Extensions > Apps Script > Project Settings > Script Properties
//   Add property: ANTHROPIC_API_KEY = sk-ant-...
function claudeProxy(prompt, maxTokens) {
  maxTokens = maxTokens || 300;

  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return { error: 'ANTHROPIC_API_KEY not set in Script Properties. Go to Extensions > Apps Script > Project Settings > Script Properties and add it.' };
  }

  const payload = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
    const code = response.getResponseCode();
    const body = JSON.parse(response.getContentText());
    if (code !== 200) {
      return { error: 'Anthropic API error ' + code + ': ' + (body.error?.message || JSON.stringify(body)) };
    }
    return { text: body.content?.[0]?.text || '' };
  } catch(e) {
    return { error: 'Proxy request failed: ' + e.message };
  }
}

// Run once manually to create / update sheets
function initialize() {
  setupSheets();
  SpreadsheetApp.getUi().alert('✅ Micro Coaching Tracker sheets ready!');
}
