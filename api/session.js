/**
 * POST /api/session  — register a new session
 * DELETE /api/session — deregister on logout
 *
 * SESSION_REGISTRY tab columns: A=SessionToken, B=EmployeeID, C=StationID, D=LoginTime, E=Status
 *
 * Duplicate prevention is best-effort (Sheets is not a transactional DB).
 * We write the session, then re-read within 2 seconds to detect races.
 * The lower UUID (lexicographically) wins; the other session must re-login.
 */
import { appendRows, readTab, getSheetsClient, SPREADSHEET_ID, TABS } from './_sheets.js';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    return registerSession(req, res);
  }
  if (req.method === 'DELETE') {
    return deregisterSession(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function registerSession(req, res) {
  const { sessionToken, employeeId, stationId, loginTime } = req.body || {};

  if (!sessionToken || !employeeId || !stationId || !loginTime) {
    return res.status(400).json({ error: 'Missing required session fields' });
  }

  try {
    // Write this session
    await appendRows(TABS.SESSION_REGISTRY, [[sessionToken, employeeId, stationId, loginTime, 'ACTIVE']]);

    // Re-read after short delay to detect concurrent logins by same employee
    await new Promise((r) => setTimeout(r, 500));
    const rows = await readTab(TABS.SESSION_REGISTRY);

    // Find all ACTIVE sessions for this employee (excluding our own just-written one)
    const activeDuplicates = rows
      .slice(1)
      .filter(
        (row) =>
          row[1] === employeeId &&
          row[4] === 'ACTIVE' &&
          row[0] !== sessionToken
      );

    if (activeDuplicates.length > 0) {
      // Another session exists — return conflict so client can warn the user
      return res.status(409).json({
        conflict: true,
        existingStation: activeDuplicates[0][2],
        sessionToken,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function deregisterSession(req, res) {
  const { sessionToken } = req.body || {};
  if (!sessionToken) {
    return res.status(400).json({ error: 'sessionToken required' });
  }

  try {
    // Find the row with this session token and mark it INACTIVE
    const rows = await readTab(TABS.SESSION_REGISTRY);
    const rowIndex = rows.findIndex((row) => row[0] === sessionToken);

    if (rowIndex === -1) {
      // Already gone — not an error
      return res.status(200).json({ ok: true });
    }

    const sheets = getSheetsClient();
    // +1 for 1-based Sheets row index, +1 for header row
    const sheetRow = rowIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TABS.SESSION_REGISTRY}!E${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [['INACTIVE']] },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
