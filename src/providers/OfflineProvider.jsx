/**
 * OfflineProvider — tracks connectivity and queue depth.
 * Uses both navigator.onLine and an active fetch probe (more reliable than the event alone).
 * Exposes { isOnline, queueCount, syncState } to the whole app.
 */
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { getQueueCount } from '../services/db.js';
import { startSyncEngine, stopSyncEngine, getSyncState } from '../services/syncEngine.js';
import { useAuth } from './AuthProvider.jsx';

const OfflineContext = createContext(null);

// Probe a fast endpoint to verify true connectivity (navigator.onLine lies in some cases)
const PROBE_URL = `${import.meta.env.VITE_API_BASE_URL || ''}/api/employees`;
const PROBE_INTERVAL_MS = 30_000;

export function OfflineProvider({ children }) {
  const { session } = useAuth();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(0);
  const [syncState, setSyncState] = useState({});
  const probeRef = useRef(null);

  const updateQueueCount = useCallback(async () => {
    const count = await getQueueCount();
    setQueueCount(count);
  }, []);

  // Connectivity probe
  useEffect(() => {
    async function probe() {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(PROBE_URL, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
        clearTimeout(tid);
        setIsOnline(res.ok || res.status < 500);
      } catch {
        clearTimeout(tid);
        setIsOnline(false);
      }
    }

    probeRef.current = setInterval(probe, PROBE_INTERVAL_MS);
    probe(); // Immediate check

    const handleOnline = () => { setIsOnline(true); probe(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(probeRef.current);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Start/stop sync engine when session changes
  useEffect(() => {
    if (!session) {
      stopSyncEngine();
      return;
    }

    startSyncEngine({
      stationId: session.stationId,
      onQueueCountChange: (count) => {
        setQueueCount(count);
        setSyncState(getSyncState());
      },
    });

    updateQueueCount();

    return () => stopSyncEngine();
  }, [session?.stationId]);

  // Poll queue count every 5s while app is active
  useEffect(() => {
    const interval = setInterval(updateQueueCount, 5_000);
    return () => clearInterval(interval);
  }, [updateQueueCount]);

  return (
    <OfflineContext.Provider value={{ isOnline, queueCount, syncState, updateQueueCount }}>
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used inside OfflineProvider');
  return ctx;
}
