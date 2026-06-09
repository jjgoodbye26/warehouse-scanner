/**
 * Client-side error logger.
 * Every non-silent failure calls this — it writes to ERROR_LOG Sheet tab via /api/error-log.
 * Falls back silently if the network is down (the error is already in IndexedDB or visible to user).
 */
import { logError } from '../services/api.js';

let _sessionContext = {};

export function setLoggerContext({ employeeId, stationId }) {
  _sessionContext = { employeeId, stationId };
}

export async function reportError(errorCode, message, context = {}) {
  // Always log to console in dev
  if (import.meta.env.DEV) {
    console.error(`[${errorCode}]`, message, context);
  }

  await logError({
    timestamp: new Date().toISOString(),
    stationId: _sessionContext.stationId || 'UNKNOWN',
    employeeId: _sessionContext.employeeId || 'UNKNOWN',
    errorCode,
    message,
    context,
  });
}

// Error code constants — keeps the ERROR_LOG queryable
export const ERROR_CODES = {
  SCAN_SUBMIT_FAILED:    'SCAN_SUBMIT_FAILED',
  QUEUE_SYNC_FAILED:     'QUEUE_SYNC_FAILED',
  EMPLOYEE_LOAD_FAILED:  'EMPLOYEE_LOAD_FAILED',
  CONFIG_LOAD_FAILED:    'CONFIG_LOAD_FAILED',
  SESSION_REG_FAILED:    'SESSION_REG_FAILED',
  INDEXEDDB_UNAVAILABLE: 'INDEXEDDB_UNAVAILABLE',
  QUOTA_EXCEEDED:        'QUOTA_EXCEEDED',
  CIRCUIT_BREAKER_OPEN:  'CIRCUIT_BREAKER_OPEN',
  UNKNOWN:               'UNKNOWN',
};
