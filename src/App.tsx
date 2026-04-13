import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/useAuth';
import LoginPage from './pages/LoginPage';
import AppShell from './components/layout/AppShell';
import RoleGuard from './components/guards/RoleGuard';
import AppLayout from './components/layout/AppLayout';
import DiagramEditorPage from './pages/DiagramEditorPage';
import DiagramReviewPage from './pages/DiagramReviewPage';
import DiagramViewerPage from './pages/DiagramViewerPage';
import UserManagementPage from './pages/UserManagementPage';
import DistrictPage from './pages/DistrictPage';
import LinePage from './pages/LinePage';
import GisPage from './pages/GisPage';
import AuditPage from './pages/AuditPage';
import './App.css';

function LoginRoute() {
  const { user, loading, login } = useAuth();
  if (loading) return <div className="booting">正在初始化...</div>;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage onSubmit={login} />;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="booting">正在初始化...</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/viewer" replace />} />
        <Route path="components" element={<RoleGuard roles={['ADMIN', 'COMPONENT_EDITOR', 'DIAGRAM_EDITOR']}><div className="page-component"><AppLayout /></div></RoleGuard>} />
        <Route path="diagrams" element={<RoleGuard roles={['ADMIN', 'DIAGRAM_EDITOR']}><DiagramEditorPage /></RoleGuard>} />
        <Route path="reviews" element={<RoleGuard roles={['ADMIN', 'REVIEWER']}><DiagramReviewPage /></RoleGuard>} />
        <Route path="viewer" element={<DiagramViewerPage />} />
        <Route path="districts" element={<RoleGuard roles={['ADMIN', 'DIAGRAM_EDITOR', 'DISTRICT_EDITOR']}><DistrictPage /></RoleGuard>} />
        <Route path="lines" element={<RoleGuard roles={['ADMIN', 'DIAGRAM_EDITOR', 'LINE_EDITOR']}><LinePage /></RoleGuard>} />
        <Route path="gis" element={<RoleGuard roles={['ADMIN', 'DIAGRAM_EDITOR', 'GIS_EDITOR']}><GisPage /></RoleGuard>} />
        <Route path="admin/users" element={<RoleGuard roles={['ADMIN']}><UserManagementPage /></RoleGuard>} />
        <Route path="admin/audits" element={<RoleGuard roles={['ADMIN']}><AuditPage /></RoleGuard>} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/*" element={<AppRoutes />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
