/**
 * Sync Engine — drains the IndexedDB scan queue to Google Sheets via the API proxy.
 *
 * State machine: IDLE → READING_QUEUE → WRITING → (IDLE | OFFLINE_WAIT | CIRCUIT_BREAKER_OPEN)
 *
 * Race condition mitigations:
 *   - Staggered flush: base interval + per-station jitter (stationId % 10 * 1000ms)
 *     distributes 30 stations across a 10-second window instead of synchronizing bursts
 *   - Circuit breaker: after 10 consecutive failures, pause 5 minutes before retrying
 *   - UUID-based dedup: each scan has a client-generated UUID so retry batches
 *     don't create phantom duplicates (server-side dedup check possible via UUID column)
 */
import { getQueuedScans, markScansStatus, getQueueCount, isMemoryFallback } from './db.js';
import { submitScans } from './api.js';
import { reportError, ERROR_CODES } from '../utils/errorLogger.js';

const BATCH_SIZE = 10;
const BASE_FLUSH_INTERVAL_MS = 10_000;   // 10 seconds
const CIRCUIT_BREAKER_THRESHOLD = 10;    // consecutive failures before pause
const CIRCUIT_BREAKER_RESET_MS = 5 * 60 * 1000; // 5 minutes

let _state = 'IDLE';
let _consecutiveFailures = 0;
let _circuitBreakerOpenAt = null;
let _intervalHandle = null;
let _onQueueCountChange = null;
let _stationId = 'STATION-01';

/**
 * Start the sync engine.
 * @param {object} opts
 * @param {string} opts.stationId - used to compute flush jitter
 * @param {function} opts.onQueueCountChange - called with (count) when queue depth changes
 */
export function startSyncEngine({ stationId, onQueueCountChange }) {
  if (_intervalHandle) return; // Already running

  _stationId = stationId || 'STATION-01';
  _onQueueCountChange = onQueueCountChange || (() => {});

  // Parse station number for jitter: "STATION-07" → 7
  const stationNum = parseInt(_stationId.replace(/\D/g, ''), 10) || 1;
  const jitter = (stationNum % 10) * 1000; // 0–9 seconds of offset

  // Start after jitter delay so stations don't all fire at t=0
  setTimeout(() => {
    _intervalHandle = setInterval(tick, BASE_FLUSH_INTERVAL_MS);
    tick(); // Immediate first tick after jitter
  }, jitter);

  // Also sync immediately when connection is restored
  window.addEventListener('online', onConnectionRestored);
}

export function stopSyncEngine() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
  window.removeEventListener('online', onConnectionRestored);
}

/**
 * Force an immediate sync attempt — called after a scan is enqueued
 * when the queue reaches BATCH_SIZE (don't wait for the interval).
 */
export async function flushNow() {
  if (_state === 'IDLE') {
    await tick();
  }
}

async function onConnectionRestored() {
  _consecutiveFailures = 0;
  _circuitBreakerOpenAt = null;
  _state = 'IDLE';
  await tick();
}

async function tick() {
  if (!navigator.onLine) {
    _state = 'OFFLINE_WAIT';
    return;
  }

  // Circuit breaker check
  if (_circuitBreakerOpenAt) {
    const elapsed = Date.now() - _circuitBreakerOpenAt;
    if (elapsed < CIRCUIT_BREAKER_RESET_MS) {
      _state = 'CIRCUIT_BREAKER_OPEN';
      return;
    }
    // Reset after cooldown
    _circuitBreakerOpenAt = null;
    _consecutiveFailures = 0;
  }

  if (_state !== 'IDLE') return; // Already in progress

  _state = 'READING_QUEUE';

  let records;
  try {
    records = await getQueuedScans(BATCH_SIZE);
  } catch (err) {
    await reportError(ERROR_CODES.QUEUE_SYNC_FAILED, 'Failed to read scan queue', { err: err.message });
    _state = 'IDLE';
    return;
  }

  if (records.length === 0) {
    _state = 'IDLE';
    return;
  }

  _state = 'WRITING';
  const uuids = records.map((r) => r.scanUUID);

  // Mark as "syncing" so we know these are in-flight (not re-queued by another tick)
  await markScansStatus(uuids, 'syncing');

  try {
    await submitScans(records);
    await markScansStatus(uuids, 'synced');
    _consecutiveFailures = 0;

    // Notify UI of new queue depth
    const remaining = await getQueueCount();
    _onQueueCountChange(remaining);

    _state = 'IDLE';

    // If there are more records waiting, schedule another tick immediately
    if (remaining > 0) {
      setTimeout(tick, 100);
    }
  } catch (err) {
    // Put records back to queued so they're retried
    await markScansStatus(uuids, 'queued', err.message);

    _consecutiveFailures++;
    if (_consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      _circuitBreakerOpenAt = Date.now();
      await reportError(ERROR_CODES.CIRCUIT_BREAKER_OPEN, 'Circuit breaker opened after repeated sync failures', {
        failures: _consecutiveFailures,
        lastError: err.message,
        stationId: _stationId,
      });
    } else {
      await reportError(ERROR_CODES.QUEUE_SYNC_FAILED, 'Scan batch sync failed', {
        attempt: _consecutiveFailures,
        error: err.message,
        stationId: _stationId,
      });
    }

    _state = 'IDLE';
  }
}

export function getSyncState() {
  return {
    state: _state,
    consecutiveFailures: _consecutiveFailures,
    circuitBreakerOpen: !!_circuitBreakerOpenAt,
    memoryFallback: isMemoryFallback(),
  };
}
