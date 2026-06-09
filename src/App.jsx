import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './providers/AuthProvider.jsx';

// Packer scan screen is NOT lazy — it's the primary path, must be instant
import ScanScreen from './screens/ScanScreen.jsx';
import LoginScreen from './screens/LoginScreen.jsx';

// Dashboard and admin are lazy — they're secondary paths
const SupervisorDashboard = lazy(() => import('./screens/SupervisorDashboard.jsx'));
const AdminPanel = lazy(() => import('./screens/AdminPanel.jsx'));

function ProtectedRoute({ children }) {
  const { session, authLoading } = useAuth();
  if (authLoading) return <div className="app-loading"><div className="spinner" /></div>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<div className="app-loading"><div className="spinner" /></div>}>
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route
          path="/scan"
          element={
            <ProtectedRoute>
              <ScanScreen />
            </ProtectedRoute>
          }
        />
        <Route path="/supervisor" element={<SupervisorDashboard />} />
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
