/**
 * AuthProvider — manages employee session lifecycle.
 *
 * On mount: attempts to restore session from IndexedDB.
 * On login: fetches employees (with offline fallback), registers session.
 * On logout: deregisters session, clears IndexedDB, redirects to /login.
 *
 * Session object shape:
 * { employeeId, employeeName, stationId, loginTime, sessionToken }
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  saveSession, loadSession, clearSession,
  cacheEmployees, getCachedEmployees,
  cacheConfig, getCachedConfig,
  isMemoryFallback,
} from '../services/db.js';
import { fetchEmployees, fetchConfig, registerSession, deregisterSession } from '../services/api.js';
import { setLoggerContext, reportError, ERROR_CODES } from '../utils/errorLogger.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [config, setConfig] = useState({});
  const [authLoading, setAuthLoading] = useState(true);
  const [loginError, setLoginError] = useState(null);
  const navigate = useNavigate();

  // Restore session and preload employees on mount
  useEffect(() => {
    async function init() {
      try {
        const [savedSession, cachedEmps, cachedConfig] = await Promise.all([
          loadSession(),
          getCachedEmployees(),
          getCachedConfig(),
        ]);

        if (savedSession) {
          setSession(savedSession);
          setLoggerContext({ employeeId: savedSession.employeeId, stationId: savedSession.stationId });
        }

        // Preload employee list — try network first, fall back to cache
        await refreshEmployees(cachedEmps);
        await refreshConfig(cachedConfig);
      } catch (err) {
        await reportError(ERROR_CODES.UNKNOWN, 'Auth init failed', { err: err.message });
      } finally {
        setAuthLoading(false);
      }
    }
    init();
  }, []);

  async function refreshEmployees(fallback = null) {
    try {
      const { employees: fresh } = await fetchEmployees();
      await cacheEmployees(fresh);
      setEmployees(fresh);
    } catch {
      // Network unavailable — use cache
      const cached = fallback || await getCachedEmployees();
      if (cached && cached.length > 0) {
        setEmployees(cached);
      } else {
        await reportError(ERROR_CODES.EMPLOYEE_LOAD_FAILED, 'Could not load employees from network or cache');
      }
    }
  }

  async function refreshConfig(fallback = null) {
    try {
      const { config: fresh } = await fetchConfig();
      await cacheConfig(fresh);
      setConfig(fresh);
    } catch {
      const cached = fallback || await getCachedConfig();
      if (cached) {
        setConfig(cached);
      } else {
        await reportError(ERROR_CODES.CONFIG_LOAD_FAILED, 'Could not load config from network or cache');
      }
    }
  }

  const login = useCallback(async (employee, stationId) => {
    setLoginError(null);

    const sessionToken = crypto.randomUUID();
    const loginTime = new Date().toISOString();
    const newSession = {
      key: 'current',
      employeeId: employee.employeeId,
      employeeName: employee.name,
      stationId: stationId || 'STATION-01',
      loginTime,
      sessionToken,
    };

    // Register session in Sheet (best-effort — don't block login on failure)
    try {
      const result = await registerSession({
        sessionToken,
        employeeId: employee.employeeId,
        stationId: stationId || 'STATION-01',
        loginTime,
      });

      if (result.status === 409) {
        // Duplicate session detected — warn but allow override
        setLoginError(
          `Warning: ${employee.name} may already be logged in at ${result.existingStation}. ` +
          `Proceeding will take over that session.`
        );
        // Don't return — allow login to proceed after warning is shown
        // The user must click login again to confirm (handled in LoginScreen)
        return { conflict: true, existingStation: result.existingStation };
      }
    } catch (err) {
      await reportError(ERROR_CODES.SESSION_REG_FAILED, 'Session registration failed', { err: err.message });
      // Continue anyway — session registration is advisory
    }

    await saveSession(newSession);
    setSession(newSession);
    setLoggerContext({ employeeId: newSession.employeeId, stationId: newSession.stationId });
    navigate('/scan');
    return { conflict: false };
  }, [navigate]);

  const logout = useCallback(async () => {
    if (session?.sessionToken) {
      await deregisterSession(session.sessionToken);
    }
    await clearSession();
    setSession(null);
    setLoggerContext({});
    navigate('/login');
  }, [session, navigate]);

  return (
    <AuthContext.Provider value={{
      session,
      employees,
      config,
      authLoading,
      loginError,
      setLoginError,
      login,
      logout,
      isMemoryFallback: isMemoryFallback(),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
