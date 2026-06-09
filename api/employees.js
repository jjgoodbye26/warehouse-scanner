/**
 * GET /api/employees
 * Returns the employee list from the EMPLOYEES tab.
 * Response is cached for 5 minutes at the CDN edge (Cache-Control header)
 * to reduce Sheets API reads across 30 simultaneous logins.
 *
 * EMPLOYEES tab expected columns: A=EmployeeID, B=Name, C=Active(TRUE/FALSE)
 */
import { readTab, TABS } from './_sheets.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rows = await readTab(TABS.EMPLOYEES);

    // Skip header row (row 0), filter only active employees
    const employees = rows
      .slice(1)
      .filter((row) => row[2]?.toUpperCase() === 'TRUE')
      .map((row) => ({
        employeeId: row[0]?.trim(),
        name: row[1]?.trim(),
      }))
      .filter((e) => e.employeeId && e.name);

    // Cache at CDN for 5 minutes — individual clients also cache in IndexedDB
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({ employees });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
