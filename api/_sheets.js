/**
 * Shared Google Sheets client for all serverless functions.
 * Service account credentials live only here — never reach the browser.
 */
import { google } from 'googleapis';

let _auth = null;

function getAuth() {
  if (_auth) return _auth;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set');

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }

  _auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return _auth;
}

export function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

export const SPREADSHEET_ID = process.env.VITE_GOOGLE_SHEETS_ID;

// Tab names — single source of truth
export const TABS = {
  SCAN_LOG:         'SCAN_LOG',
  EMPLOYEES:        'EMPLOYEES',
  CONFIG:           'CONFIG',
  ERROR_LOG:        'ERROR_LOG',
  SESSION_REGISTRY: 'SESSION_REGISTRY',
};

/**
 * Append rows to a named tab. Uses INSERT_ROWS so concurrent appends
 * from 30 stations never overwrite each other — each append is atomic
 * at the Sheets API level.
 */
export async function appendRows(tabName, rows) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

/**
 * Read all rows from a named tab.
 */
export async function readTab(tabName) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A:Z`,
  });
  return res.data.values || [];
}
