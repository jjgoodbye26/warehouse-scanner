/**
 * ScanScreen — the primary packer interface.
 *
 * Critical focus management:
 *   - Input field MUST stay focused at all times
 *   - MutationObserver watches for DOM changes that could steal focus
 *   - visibilitychange and focus events both trigger refocus
 *   - Zebra DS2278 sends Enter after each scan — this is the auto-submit trigger
 *
 * Debounce strategy:
 *   - 300ms window: if same barcode arrives twice within 300ms, only first is processed
 *   - Prevents double-scan from scanner trigger bounce
 *   - Different barcodes within 300ms are allowed (genuine fast scanning)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../providers/AuthProvider.jsx';
import { useOffline } from '../providers/OfflineProvider.jsx';
import { detectBarcodeType, isScanPlausible } from '../services/barcodeValidator.js';
import { enqueueScan } from '../services/db.js';
import { flushNow } from '../services/syncEngine.js';
import { getCurrentShift } from '../utils/shift.js';
import { reportError, ERROR_CODES } from '../utils/errorLogger.js';

const DEBOUNCE_MS = 300;
const FLASH_SUCCESS_MS = 600;
const FLASH_ERROR_MS = 1200;

export default function ScanScreen() {
  const { session, config, logout } = useAuth();
  const { isOnline, queueCount, syncState } = useOffline();

  const inputRef = useRef(null);
  const lastScanRef = useRef({ barcode: '', ts: 0 });
  const [inputValue, setInputValue] = useState('');
  const [flash, setFlash] = useState(null);
  const [flashMessage, setFlashMessage] = useState('');
  const [lastScanInfo, setLastScanInfo] = useState(null);
  const [scanCount, setScanCount] = useState(0);

  // ─── Focus Management ───────────────────────────────────────────────────────

  const focusInput = useCallback(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    focusInput();

    const handleVisibility = () => { if (document.visibilityState === 'visible') focusInput(); };
    document.addEventListener('visibilitychange', handleVisibility);

    const handleClick = () => setTimeout(focusInput, 0);
    document.addEventListener('click', handleClick);

    const observer = new MutationObserver(() => setTimeout(focusInput, 50));
    observer.observe(document.body, { childList: true, subtree: true, attributes: false });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('click', handleClick);
      observer.disconnect();
    };
  }, [focusInput]);

  // ─── Scan Processing ────────────────────────────────────────────────────────

  const processScan = useCallback(async (rawBarcode) => {
    const barcode = rawBarcode.trim();

    if (!isScanPlausible(barcode)) {
      triggerFlash('error', 'Invalid scan — too short or invalid characters');
      return;
    }

    const now = Date.now();
    if (barcode === lastScanRef.current.barcode && now - lastScanRef.current.ts < DEBOUNCE_MS) {
      return;
    }
    lastScanRef.current = { barcode, ts: now };

    const { type: barcodeType, warning } = detectBarcodeType(barcode);
    const shift = getCurrentShift(config);
    const timestamp = new Date().toISOString();

    const scanRecord = {
      scanUUID: crypto.randomUUID(),
      timestamp,
      employeeName: session.employeeName,
      employeeId: session.employeeId,
      barcode,
      barcodeType,
      shift,
      stationId: session.stationId,
      team: session.team || 'Whatnot',
      syncStatus: 'queued',
      retryCount: 0,
      lastRetryAt: null,
      errorMessage: null,
    };

    try {
      await enqueueScan(scanRecord);
    } catch (err) {
      await reportError(ERROR_CODES.SCAN_SUBMIT_FAILED, 'Failed to enqueue scan', {
        barcode,
        err: err.message,
      });
      triggerFlash('error', 'Failed to save scan — try again');
      return;
    }

    setScanCount((c) => c + 1);
    setLastScanInfo({ barcode, barcodeType, timestamp, warning });

    if (warning) {
      triggerFlash('error', warning);
    } else {
      triggerFlash('success', barcodeType);
    }

    flushNow().catch(() => {});
  }, [session, config]);

  function triggerFlash(type, message) {
    setFlash(type);
    setFlashMessage(message);
    setTimeout(() => setFlash(null), type === 'success' ? FLASH_SUCCESS_MS : FLASH_ERROR_MS);
  }

  // ─── Input Handler ──────────────────────────────────────────────────────────

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = inputValue.trim();
      setInputValue('');
      if (val) processScan(val);
      requestAnimationFrame(focusInput);
    }
  }

  // ─── UI ─────────────────────────────────────────────────────────────────────

  const shift = getCurrentShift(config);
  const team = session?.team || 'Whatnot';

  return (
    <div className={`scan-screen ${flash ? `flash-${flash}` : ''}`}>
      {/* Status Bar */}
      <div className="status-bar">
        <div className="status-left">
          <img src="/logo.svg" alt="Goodbye Inventory" className="status-logo" />
          <span className="status-name">{session?.employeeName}</span>
          <span className={`team-badge team-badge-${team.toLowerCase()}`}>{team}</span>
          <span className="status-station">{session?.stationId}</span>
          <span className={`status-shift shift-${shift.toLowerCase()}`}>{shift}</span>
        </div>
        <div className="status-right">
          {!isOnline && (
            <span className="status-offline">OFFLINE</span>
          )}
          {queueCount > 0 && (
            <span className="status-queue" title="Scans waiting to sync">
              {queueCount} queued
            </span>
          )}
          {syncState.circuitBreakerOpen && (
            <span className="status-circuit-breaker" title="Sync paused — too many failures">
              SYNC PAUSED
            </span>
          )}
          <span className="status-count">{scanCount} scans</span>
          <button className="btn-logout" onClick={logout} type="button">Logout</button>
        </div>
      </div>

      {/* Main Scan Area */}
      <div className="scan-area">
        <div className="scan-prompt">
          {flash === 'success' ? '✓ SCANNED' : flash === 'error' ? '✗ ERROR' : 'READY TO SCAN'}
        </div>

        <input
          ref={inputRef}
          type="text"
          className="scan-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(focusInput, 0)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="none"
          aria-label="Scan input — point scanner and scan"
          placeholder="Point scanner here…"
        />

        {flashMessage && (
          <div className={`flash-message flash-message-${flash}`}>
            {flashMessage}
          </div>
        )}

        {lastScanInfo && (
          <div className="last-scan-info">
            <span className="last-scan-barcode">{lastScanInfo.barcode}</span>
            <span className={`last-scan-type type-${lastScanInfo.barcodeType.toLowerCase()}`}>
              {lastScanInfo.barcodeType}
            </span>
            <span className="last-scan-time">
              {new Date(lastScanInfo.timestamp).toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>

      {/* Offline Banner */}
      {!isOnline && (
        <div className="offline-banner">
          <strong>OFFLINE MODE</strong> — scans are saved locally and will sync automatically when connection returns
        </div>
      )}
    </div>
  );
}
