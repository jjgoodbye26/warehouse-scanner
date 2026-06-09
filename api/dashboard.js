/**
 * GET /api/dashboard?date=YYYY-MM-DD
 * Returns aggregated scan data for the supervisor dashboard.
 * Reads SCAN_LOG and aggregates by employee for the requested date.
 *
 * To avoid reading millions of rows, we filter by date prefix on the timestamp column.
 * For scale, this should eventually move to a dedicated summary tab written by a
 * scheduled Cloud Function — but for 150k-300k orders/month this approach is viable.
 */
import { readTab, TABS } from './_sheets.js';
import bcrypt from 'bcryptjs';

const SUPERVISOR_PIN_HASH = process.env.SUPERVISOR_PIN_HASH;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // PIN verification via Authorization header: "Bearer <pin>"
  const auth = req.headers.authorization || '';
  const pin = auth.replace('Bearer ', '').trim();
  if (!pin || !SUPERVISOR_PIN_HASH) {
    return res.status(401).json({ error: 'Authorization required' });
  }
  const valid = await bcrypt.compare(pin, SUPERVISOR_PIN_HASH);
  if (!valid) {
    return res.status(403).json({ error: 'Invalid PIN' });
  }

  const date = req.query.date || new Date().toISOString().slice(0, 10);

  try {
    const rows = await readTab(TABS.SCAN_LOG);

    // Filter rows for the requested date (timestamp column starts with YYYY-MM-DD)
    // Row format: [timestamp, employeeName, employeeId, barcode, barcodeType, shift, stationId, syncStatus, scanUUID]
    const dayRows = rows.slice(1).filter((row) => row[0]?.startsWith(date));

    // Aggregate per employee
    const byEmployee = {};
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const tenMinutesAgo = now - 10 * 60 * 1000;

    for (const row of dayRows) {
      const [timestamp, employeeName, employeeId, , , , stationId] = row;
      const ts = new Date(timestamp).getTime();
      if (!employeeId) continue;

      if (!byEmployee[employeeId]) {
        byEmployee[employeeId] = {
          employeeId,
          employeeName: employeeName || employeeId,
          stationId: stationId || '—',
          scansToday: 0,
          scansThisHour: 0,
          lastScanTime: null,
          lastScanTs: 0,
          hourlyBreakdown: {},
        };
      }

      const emp = byEmployee[employeeId];
      emp.scansToday++;
      if (ts >= oneHourAgo) emp.scansThisHour++;
      if (ts > emp.lastScanTs) {
        emp.lastScanTs = ts;
        emp.lastScanTime = timestamp;
      }

      // Hourly breakdown key: "HH:00"
      const hour = timestamp.slice(11, 13) + ':00';
      emp.hourlyBreakdown[hour] = (emp.hourlyBreakdown[hour] || 0) + 1;
    }

    const employees = Object.values(byEmployee).map((emp) => ({
      ...emp,
      status: !emp.lastScanTs
        ? 'OFFLINE'
        : emp.lastScanTs < tenMinutesAgo
        ? 'IDLE'
        : 'ACTIVE',
      hourlyBreakdown: Object.entries(emp.hourlyBreakdown)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([hour, count]) => ({ hour, count })),
    }));

    // Sort by scans today descending (leaderboard)
    employees.sort((a, b) => b.scansToday - a.scansToday);

    return res.status(200).json({ date, employees, totalScans: dayRows.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
