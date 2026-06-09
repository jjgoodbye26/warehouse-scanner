/**
 * API client — all calls go through the Vercel serverless proxy.
 * Implements exponential backoff for 429 and 5xx responses.
 * Logs all failures to ERROR_LOG via /api/error-log.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// ─── Core fetch with timeout ──────────────────────────────────────────────────

async function apiFetch(path, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('Request timed out'), { code: 'TIMEOUT' });
    }
    throw err;
  }
}

// ─── Exponential backoff retry ────────────────────────────────────────────────
// Delays: 1s, 2s, 4s — then gives up and returns the last response/error

async function withBackoff(fn, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fn();
      // Retry on 429 or 5xx
      if (res.status === 429 || res.status >= 500) {
        lastError = { status: res.status, body: await res.json().catch(() => ({})) };
        if (attempt < maxRetries) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        return { ok: false, ...lastError };
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(1000 * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchEmployees() {
  const res = await withBackoff(() => apiFetch('/api/employees'));
  if (!res.ok) throw new Error(`Failed to fetch employees: ${res.status}`);
  return res.json();
}

export async function fetchConfig() {
  const res = await withBackoff(() => apiFetch('/api/config'));
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.status}`);
  return res.json();
}

export async function submitScans(records) {
  const res = await withBackoff(() =>
    apiFetch('/api/scan', {
      method: 'POST',
      body: JSON.stringify({ records }),
    })
  );

  if (res && !res.ok) {
    const body = typeof res.json === 'function' ? await res.json().catch(() => ({})) : res;
    throw Object.assign(new Error(body.error || 'Scan submit failed'), {
      status: res.status || body.status,
    });
  }

  return typeof res.json === 'function' ? res.json() : res;
}

export async function registerSession(sessionData) {
  const res = await apiFetch('/api/session', {
    method: 'POST',
    body: JSON.stringify(sessionData),
  });
  const body = await res.json();
  return { status: res.status, ...body };
}

export async function deregisterSession(sessionToken) {
  try {
    await apiFetch('/api/session', {
      method: 'DELETE',
      body: JSON.stringify({ sessionToken }),
    });
  } catch {
    // Logout should never block the user — swallow errors
  }
}

export async function logError(errorData) {
  try {
    await apiFetch('/api/error-log', {
      method: 'POST',
      body: JSON.stringify(errorData),
    });
  } catch {
    // Never let error logging cause a secondary failure
  }
}

export async function fetchDashboard(date, pin) {
  const res = await withBackoff(() =>
    apiFetch(`/api/dashboard?date=${date}`, {
      headers: { Authorization: `Bearer ${pin}` },
    })
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || 'Dashboard fetch failed'), {
      status: res.status,
    });
  }
  return res.json();
}

export async function verifyPin(pin) {
  const res = await apiFetch('/api/verify-pin', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
  return res.status === 200;
}

export async function adminAction(action, pin, payload = {}) {
  const res = await apiFetch('/api/admin', {
    method: 'POST',
    body: JSON.stringify({ action, pin, ...payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Admin action failed: ${res.status}`);
  return body;
}
