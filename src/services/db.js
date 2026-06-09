/**
 * IndexedDB wrapper using the idb library.
 * All scan data lives here first — the sync engine drains it to Sheets.
 *
 * Failure handling:
 *   - openDB failure: fall back to in-memory queue (data lost on refresh, user warned)
 *   - Storage quota: prune oldest SYNCED records before refusing new writes
 */
import { openDB } from 'idb';

const DB_NAME = 'WarehouseScanDB';
const DB_VERSION = 1;
const STORE_SCANS = 'scan_queue';
const STORE_EMPLOYEES = 'employee_cache';
const STORE_CONFIG = 'config_cache';
const STORE_SESSION = 'session_state';

// In-memory fallback if IndexedDB is unavailable (e.g. private browsing)
let _db = null;
let _memoryFallback = false;
const _memoryQueue = [];

async function getDB() {
  if (_db) return _db;
  if (_memoryFallback) return null;

  try {
    _db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_SCANS)) {
          const store = db.createObjectStore(STORE_SCANS, { keyPath: 'scanUUID' });
          store.createIndex('status', 'status');
          store.createIndex('timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains(STORE_EMPLOYEES)) {
          db.createObjectStore(STORE_EMPLOYEES, { keyPath: 'employeeId' });
        }
        if (!db.objectStoreNames.contains(STORE_CONFIG)) {
          db.createObjectStore(STORE_CONFIG, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_SESSION)) {
          db.createObjectStore(STORE_SESSION, { keyPath: 'key' });
        }
      },
    });
    return _db;
  } catch (err) {
    console.warn('[DB] IndexedDB unavailable, using memory fallback:', err.message);
    _memoryFallback = true;
    return null;
  }
}

// ─── Scan Queue ───────────────────────────────────────────────────────────────

export async function enqueueScan(record) {
  const db = await getDB();
  if (!db) {
    _memoryQueue.push(record);
    return;
  }

  try {
    await db.put(STORE_SCANS, { ...record, syncStatus: 'queued' });
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      // Prune oldest SYNCED records and retry once
      await pruneSyncedRecords(db, 500);
      await db.put(STORE_SCANS, { ...record, syncStatus: 'queued' });
    } else {
      throw err;
    }
  }
}

export async function getQueuedScans(limit = 10) {
  const db = await getDB();
  if (!db) return _memoryQueue.slice(0, limit);

  const tx = db.transaction(STORE_SCANS, 'readonly');
  const index = tx.store.index('status');
  const records = [];
  let cursor = await index.openCursor('queued');

  while (cursor && records.length < limit) {
    records.push(cursor.value);
    cursor = await cursor.continue();
  }

  // Sort oldest first to guarantee ordered delivery
  return records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function markScansStatus(uuids, status, errorMessage = null) {
  const db = await getDB();
  if (!db) {
    if (status === 'synced') {
      const ids = new Set(uuids);
      const remaining = _memoryQueue.filter((r) => !ids.has(r.scanUUID));
      _memoryQueue.length = 0;
      _memoryQueue.push(...remaining);
    }
    return;
  }

  const tx = db.transaction(STORE_SCANS, 'readwrite');
  await Promise.all(
    uuids.map(async (uuid) => {
      const record = await tx.store.get(uuid);
      if (record) {
        await tx.store.put({ ...record, syncStatus: status, errorMessage: errorMessage || null });
      }
    })
  );
  await tx.done;
}

export async function getQueueCount() {
  const db = await getDB();
  if (!db) return _memoryQueue.length;

  const tx = db.transaction(STORE_SCANS, 'readonly');
  const index = tx.store.index('status');
  return await index.count('queued');
}

export function isMemoryFallback() {
  return _memoryFallback;
}

async function pruneSyncedRecords(db, pruneCount) {
  const tx = db.transaction(STORE_SCANS, 'readwrite');
  const index = tx.store.index('status');
  let cursor = await index.openCursor('synced');
  let count = 0;
  while (cursor && count < pruneCount) {
    await cursor.delete();
    cursor = await cursor.continue();
    count++;
  }
  await tx.done;
}

// ─── Employee Cache ───────────────────────────────────────────────────────────

export async function cacheEmployees(employees) {
  const db = await getDB();
  if (!db) return;
  const tx = db.transaction(STORE_EMPLOYEES, 'readwrite');
  await tx.store.clear();
  await Promise.all(employees.map((e) => tx.store.put(e)));
  await tx.store.put({ employeeId: '__cached_at', name: new Date().toISOString() });
  await tx.done;
}

export async function getCachedEmployees() {
  const db = await getDB();
  if (!db) return null;
  const all = await db.getAll(STORE_EMPLOYEES);
  const employees = all.filter((e) => e.employeeId !== '__cached_at');
  return employees.length > 0 ? employees : null;
}

// ─── Config Cache ─────────────────────────────────────────────────────────────

export async function cacheConfig(config) {
  const db = await getDB();
  if (!db) return;
  const tx = db.transaction(STORE_CONFIG, 'readwrite');
  await tx.store.clear();
  for (const [key, value] of Object.entries(config)) {
    await tx.store.put({ key, value });
  }
  await tx.done;
}

export async function getCachedConfig() {
  const db = await getDB();
  if (!db) return null;
  const all = await db.getAll(STORE_CONFIG);
  if (all.length === 0) return null;
  return Object.fromEntries(all.map((r) => [r.key, r.value]));
}

// ─── Session State ────────────────────────────────────────────────────────────

export async function saveSession(session) {
  const db = await getDB();
  if (!db) return;
  await db.put(STORE_SESSION, { key: 'current', ...session });
}

export async function loadSession() {
  const db = await getDB();
  if (!db) return null;
  const record = await db.get(STORE_SESSION, 'current');
  return record || null;
}

export async function clearSession() {
  const db = await getDB();
  if (!db) return;
  await db.delete(STORE_SESSION, 'current');
}
