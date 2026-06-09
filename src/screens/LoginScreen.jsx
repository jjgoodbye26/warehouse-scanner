import { useState } from 'react';
import { useAuth } from '../providers/AuthProvider.jsx';

const DEFAULT_STATION = import.meta.env.VITE_STATION_ID || '';

export default function LoginScreen() {
  const { employees, login, loginError, setLoginError, authLoading, isMemoryFallback } = useAuth();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [stationId, setStationId] = useState(DEFAULT_STATION);
  const [pendingConflict, setPendingConflict] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedEmployee = employees.find((e) => e.employeeId === selectedEmployeeId);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedEmployee || !stationId.trim()) return;

    setSubmitting(true);
    setLoginError(null);
    setPendingConflict(null);

    try {
      const result = await login(selectedEmployee, stationId.trim());
      if (result?.conflict) {
        setPendingConflict(result.existingStation);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForceLogin() {
    if (!selectedEmployee) return;
    setSubmitting(true);
    setPendingConflict(null);
    try {
      // Second call — server already warned, we proceed anyway
      await login(selectedEmployee, stationId.trim(), true);
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) {
    return (
      <div className="login-loading">
        <div className="spinner" />
        <p>Loading employee list…</p>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">Warehouse Scanner</h1>
        <p className="login-subtitle">Select your name to begin scanning</p>

        {isMemoryFallback && (
          <div className="banner banner-warn">
            Storage unavailable — scans will be lost if you refresh this page
          </div>
        )}

        {employees.length === 0 && (
          <div className="banner banner-error">
            Employee list unavailable. Check your connection and reload.
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <label className="field-label" htmlFor="employee-select">
            Employee
          </label>
          <select
            id="employee-select"
            className="field-select"
            value={selectedEmployeeId}
            onChange={(e) => { setSelectedEmployeeId(e.target.value); setPendingConflict(null); }}
            required
          >
            <option value="">— Select your name —</option>
            {employees.map((emp) => (
              <option key={emp.employeeId} value={emp.employeeId}>
                {emp.name}
              </option>
            ))}
          </select>

          <label className="field-label" htmlFor="station-input">
            Station ID
          </label>
          <input
            id="station-input"
            className="field-input"
            type="text"
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
            placeholder="e.g. STATION-07"
            required
          />

          {loginError && !pendingConflict && (
            <div className="banner banner-error">{loginError}</div>
          )}

          {pendingConflict ? (
            <div className="conflict-block">
              <p className="conflict-text">
                <strong>{selectedEmployee?.name}</strong> appears to already be logged in at{' '}
                <strong>{pendingConflict}</strong>.
              </p>
              <div className="conflict-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setPendingConflict(null); setSelectedEmployeeId(''); }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleForceLogin}
                  disabled={submitting}
                >
                  Take Over Session
                </button>
              </div>
            </div>
          ) : (
            <button
              type="submit"
              className="btn btn-primary btn-large"
              disabled={!selectedEmployee || !stationId.trim() || submitting || employees.length === 0}
            >
              {submitting ? 'Logging in…' : 'Start Scanning'}
            </button>
          )}
        </form>

        <div className="login-footer">
          <a href="/supervisor" className="supervisor-link">Supervisor Dashboard →</a>
        </div>
      </div>
    </div>
  );
}
