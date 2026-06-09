/**
 * POST /api/error-log
 * Appends an error record to the ERROR_LOG Sheet tab.
 * Called by the client for any non-silent failure.
 *
 * ERROR_LOG columns: A=Timestamp, B=StationID, C=EmployeeID, D=ErrorCode, E=Message, F=Context
 */
import { appendRows, TABS } from './_sheets.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { timestamp, stationId, employeeId, errorCode, message, context } = req.body || {};

  if (!timestamp || !errorCode || !message) {
    return res.status(400).json({ error: 'timestamp, errorCode, and message are required' });
  }

  try {
    await appendRows(TABS.ERROR_LOG, [[
      timestamp,
      stationId || 'UNKNOWN',
      employeeId || 'UNKNOWN',
      errorCode,
      message,
      typeof context === 'object' ? JSON.stringify(context) : (context || ''),
    ]]);
    return res.status(200).json({ ok: true });
  } catch {
    // Don't recursively error-log a failed error log — just return 500
    return res.status(500).json({ error: 'Failed to write error log' });
  }
}
