import { useState, useEffect } from 'react';
import { adminAction, verifyPin, fetchEmployees, fetchConfig } from '../services/api.js';

const PIN_MAX_ATTEMPTS = 3;
const PIN_LOCKOUT_MS = 60_000;

export default function AdminPanel() {
  const [pin, setPin] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [pinError, setPinError] = useState('');
  const [pinAttempts, setPinAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);

  const [activeTab, setActiveTab] = useState('employees');
  const [employees, setEmployees] = useState([]);
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  // New employee form
  const [newEmpId, setNewEmpId] = useState('');
  const [newEmpName, setNewEmpName] = useState('');

  // Config edit
  const [configEdits, setConfigEdits] = useState({});

  useEffect(() => {
    if (!authenticated) return;
    loadData();
  }, [authenticated]);

  async function loadData() {
    setLoading(true);
    try {
      const [{ employees: emps }, { config: cfg }] = await Promise.all([
        fetchEmployees(),
        fetchConfig(),
      ]);
      setEmployees(emps);
      setConfig(cfg);
      setConfigEdits({ ...cfg });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function verifyPin(e) {
    e.preventDefault();
    if (lockedUntil && Date.now() < lockedUntil) return;

    try {
      const ok = await verifyPin(pin);
      if (ok) {
        setAuthenticated(true);
        setPinError('');
      } else {
        throw new Error('Invalid PIN');
      }
    } catch (err) {
      const attempts = pinAttempts + 1;
      setPinAttempts(attempts);
      if (attempts >= PIN_MAX_ATTEMPTS) {
        setLockedUntil(Date.now() + PIN_LOCKOUT_MS);
        setPinError('Too many failed attempts. Locked for 60 seconds.');
      } else {
        setPinError('Invalid PIN');
      }
    }
  }

  async function handleAddEmployee(e) {
    e.preventDefault();
    if (!newEmpId.trim() || !newEmpName.trim()) return;
    setLoading(true);
    try {
      await adminAction('ADD_EMPLOYEE', pin, { employeeId: newEmpId.trim(), name: newEmpName.trim() });
      setMessage({ type: 'success', text: `Added employee: ${newEmpName}` });
      setNewEmpId('');
      setNewEmpName('');
      await loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleDeactivate(employeeId, name) {
    if (!window.confirm(`Deactivate ${name}? They will not be able to log in.`)) return;
    setLoading(true);
    try {
      await adminAction('DEACTIVATE_EMPLOYEE', pin, { employeeId });
      setMessage({ type: 'success', text: `Deactivated: ${name}` });
      await loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveConfig(e) {
    e.preventDefault();
    setLoading(true);
    try {
      // Save each changed key
      const changes = Object.entries(configEdits).filter(([k, v]) => v !== config[k]);
      for (const [key, value] of changes) {
        await adminAction('UPDATE_CONFIG', pin, { key, value });
      }
      setMessage({ type: 'success', text: `Saved ${changes.length} config value(s)` });
      await loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  if (!authenticated) {
    return (
      <div className="supervisor-login">
        <div className="supervisor-login-card">
          <h1>Admin Panel</h1>
          <form onSubmit={verifyPin}>
            <label htmlFor="admin-pin">Admin PIN</label>
            <input
              id="admin-pin"
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

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h1>Admin Panel</h1>
        <button className="btn-logout" onClick={() => setAuthenticated(false)}>Logout</button>
      </div>

      {message && (
        <div className={`banner banner-${message.type}`} onClick={() => setMessage(null)}>
          {message.text} ×
        </div>
      )}

      <div className="admin-tabs">
        {['employees', 'config'].map((tab) => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'employees' ? 'Employees' : 'Shift Config'}
          </button>
        ))}
      </div>

      {loading && <div className="loading-bar" />}

      {activeTab === 'employees' && (
        <div className="admin-section">
          <h2>Add Employee</h2>
          <form className="add-employee-form" onSubmit={handleAddEmployee}>
            <input
              type="text"
              className="field-input"
              placeholder="Employee ID (e.g. EMP-042)"
              value={newEmpId}
              onChange={(e) => setNewEmpId(e.target.value)}
              required
            />
            <input
              type="text"
              className="field-input"
              placeholder="Full Name"
              value={newEmpName}
              onChange={(e) => setNewEmpName(e.target.value)}
              required
            />
            <button type="submit" className="btn btn-primary" disabled={loading}>
              Add Employee
            </button>
          </form>

          <h2>Active Employees</h2>
          <table className="admin-table">
            <thead>
              <tr><th>ID</th><th>Name</th><th>Action</th></tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.employeeId}>
                  <td>{emp.employeeId}</td>
                  <td>{emp.name}</td>
                  <td>
                    <button
                      className="btn btn-danger-sm"
                      onClick={() => handleDeactivate(emp.employeeId, emp.name)}
                    >
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'config' && (
        <div className="admin-section">
          <h2>Shift Configuration</h2>
          <form onSubmit={handleSaveConfig}>
            {['SHIFT_AM_START', 'SHIFT_PM_START', 'SHIFT_PM_END'].map((key) => (
              <div className="config-row" key={key}>
                <label className="field-label">{key}</label>
                <input
                  type="time"
                  className="field-input"
                  value={configEdits[key] || ''}
                  onChange={(e) => setConfigEdits((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              </div>
            ))}
            <button type="submit" className="btn btn-primary" disabled={loading}>
              Save Config
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
