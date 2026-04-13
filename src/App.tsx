import { useEffect, useMemo, useState } from 'react';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/LoginPage';
import UserManagementPage from './pages/UserManagementPage';
import DiagramEditorPage from './pages/DiagramEditorPage';
import DiagramReviewPage from './pages/DiagramReviewPage';
import DiagramViewerPage from './pages/DiagramViewerPage';
import { loginApi, logoutApi, restoreSessionUser, type AuthUser, type UserRole } from './services/apiClient';
import './App.css';

type MenuKey = 'user' | 'component' | 'diagramEditor' | 'diagramReview' | 'diagramViewer';

interface MenuItem {
  key: MenuKey;
  label: string;
  roles: UserRole[];
}

const MENUS: MenuItem[] = [
  { key: 'user', label: '用户管理', roles: ['ADMIN'] },
  { key: 'component', label: '元件编辑', roles: ['ADMIN', 'COMPONENT_EDITOR'] },
  { key: 'diagramEditor', label: '图纸编辑', roles: ['ADMIN', 'DIAGRAM_EDITOR'] },
  { key: 'diagramReview', label: '图纸审核', roles: ['ADMIN', 'REVIEWER'] },
  { key: 'diagramViewer', label: '图纸查看', roles: ['ADMIN', 'COMPONENT_EDITOR', 'DIAGRAM_EDITOR', 'REVIEWER', 'DISTRICT_EDITOR', 'LINE_EDITOR', 'GIS_EDITOR', 'VIEWER'] },
];

function parseApiError(error: unknown) {
  if (!(error instanceof Error)) return '请求失败';
  const lower = error.message.toLowerCase();
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return '无法连接 API（http://localhost:3001），请先启动后端：npm run api:dev';
  }
  try {
    const payload = JSON.parse(error.message) as { message?: string };
    return payload.message || error.message;
  } catch {
    return error.message || '请求失败';
  }
}

function renderPage(menu: MenuKey) {
  if (menu === 'user') return <UserManagementPage />;
  if (menu === 'component') return <div className="page-component"><AppLayout /></div>;
  if (menu === 'diagramEditor') return <DiagramEditorPage />;
  if (menu === 'diagramReview') return <DiagramReviewPage />;
  return <DiagramViewerPage />;
}

function firstMenuByRole(roles: UserRole[]): MenuKey {
  return (MENUS.find((item) => item.roles.some((r) => roles.includes(r as UserRole)))?.key ?? 'diagramViewer') as MenuKey;
}

function App() {
  const [booting, setBooting] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeMenu, setActiveMenu] = useState<MenuKey>('diagramViewer');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const restored = await restoreSessionUser();
        if (cancelled) return;
        if (restored) {
          setUser(restored);
          setActiveMenu(firstMenuByRole(restored.roles));
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleMenus = useMemo(() => {
    if (!user) return [];
    return MENUS.filter((item) => item.roles.some((r) => user.roles.includes(r as UserRole)));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (!visibleMenus.some((item) => item.key === activeMenu)) {
      setActiveMenu(firstMenuByRole(user.roles));
    }
  }, [activeMenu, user, visibleMenus]);

  if (booting) {
    return <div className="booting">正在初始化...</div>;
  }

  if (!user) {
    return (
      <LoginPage
        loading={authLoading}
        error={authError}
        onSubmit={async (username, password) => {
          setAuthLoading(true);
          setAuthError('');
          try {
            const loggedIn = await loginApi(username, password);
            setUser(loggedIn);
            setActiveMenu(firstMenuByRole(loggedIn.roles));
          } catch (e) {
            setAuthError(parseApiError(e));
          } finally {
            setAuthLoading(false);
          }
        }}
      />
    );
  }

  return (
    <div className="shell">
      <aside className="shell-nav">
        <div className="shell-brand">ECDraw</div>
        <div className="shell-menu">
          {visibleMenus.map((menu) => (
            <button
              key={menu.key}
              className={`shell-menu-item ${activeMenu === menu.key ? 'active' : ''}`}
              onClick={() => setActiveMenu(menu.key)}
            >
              {menu.label}
            </button>
          ))}
        </div>
      </aside>

      <main className="shell-main">
        <header className="shell-topbar">
          <span>
            {user.username} ({user.roles.join(', ')})
          </span>
          <button
            className="btn btn-sm"
            onClick={() => {
              logoutApi();
              setUser(null);
              setAuthError('');
            }}
          >
            退出登录
          </button>
        </header>
        <section className="shell-content">{renderPage(activeMenu)}</section>
      </main>
    </div>
  );
}

export default App;
