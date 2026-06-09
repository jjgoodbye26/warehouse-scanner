/**
 * Determines the current shift label based on configurable shift times.
 * Shift assignment is evaluated at scan time (not login time).
 *
 * Config keys: SHIFT_AM_START (e.g. "06:00"), SHIFT_PM_START ("14:00"), SHIFT_PM_END ("02:00")
 * SHIFT_PM_END crossing midnight is handled by treating hours-only comparison.
 */

/**
 * @param {object} config - config object from CONFIG Sheet tab
 * @param {Date} [now] - optional date override for testing
 * @returns {"AM"|"PM"|"UNKNOWN"}
 */
export function getCurrentShift(config, now = new Date()) {
  if (!config?.SHIFT_AM_START || !config?.SHIFT_PM_START) return 'UNKNOWN';

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const amStart = parseTime(config.SHIFT_AM_START);
  const pmStart = parseTime(config.SHIFT_PM_START);
  const pmEnd = parseTime(config.SHIFT_PM_END || '02:00');

  // AM shift: amStart → pmStart
  if (inRange(currentMinutes, amStart, pmStart)) return 'AM';

  // PM shift: pmStart → pmEnd (may cross midnight)
  if (pmEnd < pmStart) {
    // Crosses midnight — PM shift runs e.g. 14:00 → 02:00 next day
    if (currentMinutes >= pmStart || currentMinutes < pmEnd) return 'PM';
  } else {
    if (inRange(currentMinutes, pmStart, pmEnd)) return 'PM';
  }

  return 'AM'; // Default to AM if outside defined windows
}

function parseTime(str) {
  const [h, m] = str.split(':').map(Number);
  return h * 60 + (m || 0);
}

function inRange(val, start, end) {
  return val >= start && val < end;
}
