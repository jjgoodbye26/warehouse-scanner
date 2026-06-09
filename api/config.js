/**
 * GET /api/config
 * Returns shift times and station configuration from the CONFIG tab.
 *
 * CONFIG tab expected format: A=Key, B=Value
 * Required keys: SHIFT_AM_START, SHIFT_PM_START, SHIFT_PM_END
 * Example values: "06:00", "14:00", "02:00"
 */
import { readTab, TABS } from './_sheets.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rows = await readTab(TABS.CONFIG);

    const config = {};
    rows.slice(1).forEach((row) => {
      if (row[0] && row[1]) {
        config[row[0].trim()] = row[1].trim();
      }
    });

    // Validate required keys exist
    const required = ['SHIFT_AM_START', 'SHIFT_PM_START', 'SHIFT_PM_END'];
    const missing = required.filter((k) => !config[k]);
    if (missing.length > 0) {
      return res.status(500).json({
        error: `CONFIG tab missing required keys: ${missing.join(', ')}`,
      });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({ config });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
