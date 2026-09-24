import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { ModuleGate } from './auth/ModuleGate';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { TrackerPage } from './pages/TrackerPage';
import { FeedPage } from './pages/FeedPage';
import { PIRPage } from './pages/PIRPage';
import { SOAPage } from './pages/SOAPage';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminVesselsPage } from './pages/admin/AdminVesselsPage';
import { AdminVendorMappingPage } from './pages/admin/AdminVendorMappingPage';
import { AdminVendorsPage } from './pages/admin/AdminVendorsPage';
import { AdminOwnerRecipientsPage } from './pages/admin/AdminOwnerRecipientsPage';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route element={<ModuleGate module="pi" />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/tracker" element={<TrackerPage />} />
                <Route path="/feed" element={<FeedPage />} />
              </Route>
              <Route element={<ModuleGate module="pir" />}>
                <Route path="/pir" element={<PIRPage />} />
              </Route>
              <Route element={<ModuleGate module="soa" />}>
                <Route path="/soa" element={<SOAPage />} />
              </Route>
            </Route>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="/admin/users" replace />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="vessels" element={<AdminVesselsPage />} />
              <Route path="vendor-mapping" element={<AdminVendorMappingPage />} />
              <Route path="vendors" element={<AdminVendorsPage />} />
              <Route path="owner-recipients" element={<AdminOwnerRecipientsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
