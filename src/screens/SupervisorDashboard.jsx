import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { fetchDashboard } from '../services/api.js';

const HourlyChart = lazy(() => import('../components/HourlyChart.jsx'));

const REFRESH_INTERVAL_MS = 30_000;
const PIN_MAX_ATTEMPTS = 3;
const PIN_LOCKOUT_MS = 60_000;

function toCSV(employees, date) {
  const header = 'Employee Name,Employee ID,Station,Team,Scans Today,Scans This Hour,Last Scan,Status';
  const rows = employees.map((e) =>
    [e.employeeName, e.employeeId, e.stationId, e.team || '',
      e.scansToday, e.scansThisHour, e.lastScanTime || '', e.status].join(',')
  );
  return [header, ...rows].join('\n');
}

function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SupervisorDashboard() {
  const [pin, setPin] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [pinError, setPinError] = useState('');
  const [pinAttempts, setPinAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [teamFilter, setTeamFilter] = useState('All');

  const load = useCallback(async (currentPin, currentDate) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDashboard(currentDate, currentPin);
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      if (err.status === 403) {
        setAuthenticated(false);
        setPinError('Session expired — re-enter PIN');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    load(pin, date);
    const interval = setInterval(() => load(pin, date), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [authenticated, date, load, pin]);

  function handlePinSubmit(e) {
    e.preventDefault();

    if (lockedUntil && Date.now() < lockedUntil) {
      const seconds = Math.ceil((lockedUntil - Date.now()) / 1000);
      setPinError(`Too many attempts. Try again in ${seconds}s`);
      return;
    }

    setAuthenticated(true);
    setPinAttempts(0);
  }

  useEffect(() => {
    if (pinError && pinError.includes('Session expired')) {
      const attempts = pinAttempts + 1;
      setPinAttempts(attempts);
      if (attempts >= PIN_MAX_ATTEMPTS) {
        setLockedUntil(Date.now() + PIN_LOCKOUT_MS);
        setPinError('Too many failed attempts. Locked for 60 seconds.');
      }
    }
  }, [pinError]);

  function handleExportCSV() {
    if (!data?.employees) return;
    const csv = toCSV(visibleEmployees, date);
    downloadCSV(csv, `scan-report-${date}${teamFilter !== 'All' ? `-${teamFilter}` : ''}.csv`);
  }

  if (!authenticated) {
    return (
      <div className="supervisor-login">
        <div className="supervisor-login-card">
          <div className="supervisor-logo">
            <img src="/logo.svg" alt="Goodbye Inventory" className="supervisor-logo-img" />
          </div>
          <h1>Supervisor Dashboard</h1>
          <form onSubmit={handlePinSubmit}>
            <label htmlFor="supervisor-pin">Supervisor PIN</label>
            <input
              id="supervisor-pin"
              type="password"
              inputMode="numeric"
              maxLength={8}
              className="pin-input"
              value={pin}
              onChange={(e) => { setPin(e.target.value); setPinError(''); }}
              placeholder="Enter PIN"
              autoFocus
            />
            {pinError && <p className="pin-error">{pinError}</p>}
            <button type="submit" className="btn btn-primary" disabled={!pin || !!lockedUntil}>
              Enter
            </button>
          </form>
          <a href="/login" className="back-link">← Back to Scanner Login</a>
        </div>
      </div>
    );
  }

  const allEmployees = data?.employees || [];
  const visibleEmployees = teamFilter === 'All'
    ? allEmployees
    : allEmployees.filter((e) => e.team === teamFilter);

  const activeCount = visibleEmployees.filter((e) => e.status === 'ACTIVE').length;
  const idleCount = visibleEmployees.filter((e) => e.status === 'IDLE').length;
  const totalScans = visibleEmployees.reduce((sum, e) => sum + (e.scansToday || 0), 0);

  return (
    <div className="supervisor-dashboard">
      <div className="dashboard-header">
        <div className="dashboard-header-left">
          <img src="/logo.svg" alt="Goodbye Inventory" className="dashboard-logo" />
          <h1>Supervisor Dashboard</h1>
        </div>
        <div className="dashboard-controls">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="date-picker"
          />
          <button onClick={() => load(pin, date)} className="btn btn-secondary" disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={handleExportCSV} className="btn btn-secondary" disabled={!data}>
            Export CSV
          </button>
          <button onClick={() => setAuthenticated(false)} className="btn-logout">
            Logout
          </button>
        </div>
      </div>

      {lastRefresh && (
        <p className="refresh-note">Last updated: {lastRefresh.toLocaleTimeString()} · Auto-refreshes every 30s</p>
      )}

      {error && <div className="banner banner-error">{error}</div>}

      {/* Team Filter */}
      <div className="team-filter-bar">
        {['All', 'Whatnot', 'TikTok'].map((t) => (
          <button
            key={t}
            className={`team-filter-btn ${teamFilter === t ? 'active' : ''} ${t !== 'All' ? `team-filter-${t.toLowerCase()}` : ''}`}
            onClick={() => setTeamFilter(t)}
          >
            {t}
            {t !== 'All' && data && (
              <span className="team-filter-count">
                {allEmployees.filter((e) => e.team === t).length}
              </span>
            )}
            {t === 'All' && data && (
              <span className="team-filter-count">{allEmployees.length}</span>
            )}
          </button>
        ))}
      </div>

      {data && (
        <>
          <div className="summary-cards">
            <div className="summary-card">
              <div className="summary-value">{totalScans.toLocaleString()}</div>
              <div className="summary-label">
                {teamFilter === 'All' ? 'Total Scans Today' : `${teamFilter} Scans Today`}
              </div>
            </div>
            <div className="summary-card summary-card-active">
              <div className="summary-value">{activeCount}</div>
              <div className="summary-label">Active Now</div>
            </div>
            <div className="summary-card summary-card-idle">
              <div className="summary-value">{idleCount}</div>
              <div className="summary-label">Idle (&gt;10 min)</div>
            </div>
            <div className="summary-card">
              <div className="summary-value">{visibleEmployees.length}</div>
              <div className="summary-label">Total Packers</div>
            </div>
          </div>

          <div className="table-wrapper">
            <table className="packer-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Team</th>
                  <th>Station</th>
                  <th>Scans/Hr</th>
                  <th>Scans Today</th>
                  <th>Last Scan</th>
                  <th>Status</th>
                  <th>Chart</th>
                </tr>
              </thead>
              <tbody>
                {visibleEmployees.map((emp, i) => (
                  <tr key={emp.employeeId} className={`status-row-${emp.status.toLowerCase()}`}>
                    <td className="rank">{i + 1}</td>
                    <td className="emp-name">{emp.employeeName}</td>
                    <td>
                      {emp.team && (
                        <span className={`team-badge team-badge-${emp.team.toLowerCase()}`}>
                          {emp.team}
                        </span>
                      )}
                    </td>
                    <td>{emp.stationId}</td>
                    <td>{emp.scansThisHour}</td>
                    <td className="scans-today">{emp.scansToday.toLocaleString()}</td>
                    <td className="last-scan">
                      {emp.lastScanTime
                        ? new Date(emp.lastScanTime).toLocaleTimeString()
                        : '—'}
                    </td>
                    <td>
                      <span className={`status-badge status-${emp.status.toLowerCase()}`}>
                        {emp.status}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn-chart-toggle"
                        onClick={() => setSelectedEmployee(selectedEmployee?.employeeId === emp.employeeId ? null : emp)}
                      >
                        {selectedEmployee?.employeeId === emp.employeeId ? 'Hide' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedEmployee && (
            <div className="chart-panel">
              <h3>Hourly breakdown — {selectedEmployee.employeeName}</h3>
              <Suspense fallback={<div>Loading chart…</div>}>
                <HourlyChart data={selectedEmployee.hourlyBreakdown} />
              </Suspense>
            </div>
          )}
        </>
      )}
    </div>
  );
}
