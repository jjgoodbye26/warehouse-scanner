/**
 * POST /api/admin
 * Admin operations: add/remove employees, update config.
 * All operations require supervisor PIN.
 *
 * Body: { action, pin, ...payload }
 * Actions: ADD_EMPLOYEE | DEACTIVATE_EMPLOYEE | UPDATE_CONFIG | CLEAR_QUEUE_ERRORS
 */
import { readTab, appendRows, getSheetsClient, SPREADSHEET_ID, TABS } from './_sheets.js';
import bcrypt from 'bcryptjs';

const SUPERVISOR_PIN_HASH = process.env.SUPERVISOR_PIN_HASH;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, pin, ...payload } = req.body || {};

  if (!pin || !SUPERVISOR_PIN_HASH) {
    return res.status(401).json({ error: 'PIN required' });
  }
  const valid = await bcrypt.compare(pin, SUPERVISOR_PIN_HASH);
  if (!valid) {
    return res.status(403).json({ error: 'Invalid PIN' });
  }

  try {
    switch (action) {
      case 'ADD_EMPLOYEE':
        return addEmployee(req, res, payload);
      case 'DEACTIVATE_EMPLOYEE':
        return deactivateEmployee(req, res, payload);
      case 'UPDATE_CONFIG':
        return updateConfig(req, res, payload);
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function addEmployee(req, res, { employeeId, name }) {
  if (!employeeId || !name) {
    return res.status(400).json({ error: 'employeeId and name required' });
  }

  // Check for duplicate ID
  const rows = await readTab(TABS.EMPLOYEES);
  const exists = rows.some((row) => row[0] === employeeId);
  if (exists) {
    return res.status(409).json({ error: `Employee ID ${employeeId} already exists` });
  }

  await appendRows(TABS.EMPLOYEES, [[employeeId, name, 'TRUE']]);
  return res.status(200).json({ ok: true });
}

async function deactivateEmployee(req, res, { employeeId }) {
  if (!employeeId) {
    return res.status(400).json({ error: 'employeeId required' });
  }

  const rows = await readTab(TABS.EMPLOYEES);
  const rowIndex = rows.findIndex((row) => row[0] === employeeId);
  if (rowIndex === -1) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TABS.EMPLOYEES}!C${rowIndex + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['FALSE']] },
  });

  return res.status(200).json({ ok: true });
}

async function updateConfig(req, res, { key, value }) {
  if (!key || value === undefined) {
    return res.status(400).json({ error: 'key and value required' });
  }

  const rows = await readTab(TABS.CONFIG);
  const rowIndex = rows.findIndex((row) => row[0] === key);

  const sheets = getSheetsClient();

  if (rowIndex === -1) {
    // Key doesn't exist — append it
    await appendRows(TABS.CONFIG, [[key, value]]);
  } else {
    // Update existing value
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TABS.CONFIG}!B${rowIndex + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[value]] },
    });
  }

  return res.status(200).json({ ok: true });
}
