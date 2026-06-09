/**
 * POST /api/scan
 * Accepts a batch of scan records and appends them to SCAN_LOG.
 *
 * Body: { records: ScanRecord[] }
 * Each ScanRecord must include scanUUID to allow client-side dedup detection.
 *
 * Sheet columns:
 * Timestamp | Employee Name | Employee ID | Barcode | Barcode Type | Shift | Station ID | Team | Sync Status | Scan UUID
 */
import { appendRows, TABS } from './_sheets.js';

const REQUIRED_FIELDS = [
  'scanUUID', 'timestamp', 'employeeName', 'employeeId',
  'barcode', 'barcodeType', 'shift', 'stationId',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { records } = req.body || {};

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records must be a non-empty array' });
  }

  if (records.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 records per batch' });
  }

  for (const rec of records) {
    for (const field of REQUIRED_FIELDS) {
      if (!rec[field]) {
        return res.status(400).json({
          error: `Missing required field: ${field}`,
          scanUUID: rec.scanUUID || 'unknown',
        });
      }
    }
  }

  // Timestamp | Employee Name | Employee ID | Barcode | Barcode Type | Shift | Station ID | Team | Sync Status | Scan UUID
  const rows = records.map((r) => [
    r.timestamp,
    r.employeeName,
    r.employeeId,
    r.barcode,
    r.barcodeType,
    r.shift,
    r.stationId,
    r.team || 'Whatnot',
    'SYNCED',
    r.scanUUID,
  ]);

  try {
    await appendRows(TABS.SCAN_LOG, rows);
    return res.status(200).json({
      ok: true,
      written: records.length,
      uuids: records.map((r) => r.scanUUID),
    });
  } catch (err) {
    const status = err?.response?.status || 500;
    return res.status(status).json({
      error: err.message,
      sheetsStatus: status,
    });
  }
}
