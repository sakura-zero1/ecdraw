import { useRef, useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import ThemeSwitcher from './ThemeSwitcher';
import WindowControls from './WindowControls';
import type { UserRole } from '../../services/unifiedClient';

const isTauri = () => !!(window as any).__TAURI_INTERNALS__;

function tauriWindow() {
  if (!isTauri()) return null;
  return import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow());
}

function startDrag(e: React.MouseEvent) {
  if ((e.target as HTMLElement).closest('button, a, input, select, [role="button"]')) return;
  tauriWindow().then((w) => w?.startDragging());
}

function toggleMaximize() {
  tauriWindow().then((w) => w?.toggleMaximize());
}

interface MenuItem {
  path: string;
  label: string;
  roles: UserRole[];
}

const MENUS: MenuItem[] = [
  { path: '/components', label: '元件编辑', roles: ['ADMIN', 'COMPONENT_EDITOR', 'DIAGRAM_EDITOR'] },
  { path: '/diagrams', label: '图纸编辑', roles: ['ADMIN', 'DIAGRAM_EDITOR'] },
  { path: '/reviews', label: '图纸审核', roles: ['ADMIN', 'REVIEWER'] },
  { path: '/viewer', label: '图纸查看', roles: ['ADMIN', 'COMPONENT_EDITOR', 'DIAGRAM_EDITOR', 'REVIEWER', 'DISTRICT_EDITOR', 'LINE_EDITOR', 'GIS_EDITOR', 'VIEWER'] },
  { path: '/districts', label: '台区维护', roles: ['ADMIN', 'DIAGRAM_EDITOR', 'DISTRICT_EDITOR'] },
  { path: '/lines', label: '线路维护', roles: ['ADMIN', 'DIAGRAM_EDITOR', 'LINE_EDITOR'] },
  { path: '/gis', label: '地理维护', roles: ['ADMIN', 'DIAGRAM_EDITOR', 'GIS_EDITOR'] },
  { path: '/admin/dashboard', label: '数据概览', roles: ['ADMIN'] },
  { path: '/admin/users', label: '用户管理', roles: ['ADMIN'] },
  { path: '/admin/audits', label: '审计日志', roles: ['ADMIN'] },
];

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [overflowOpen]);

  if (!user) return null;

  const visibleMenus = MENUS.filter((m) => m.roles.some((r) => user.roles.includes(r)));
  const maxInline = visibleMenus.length > 8 ? 6 : 7;
  const inlineMenus = visibleMenus.slice(0, maxInline);
  const overflowMenus = visibleMenus.slice(maxInline);

  return (
    <div className="shell">
      <header className="shell-topbar" onMouseDown={startDrag} onDoubleClick={toggleMaximize}>
        <div className="shell-topbar-left">
          <span className="shell-brand">EC<span className="shell-brand-accent">Draw</span></span>
          <nav className="shell-nav">
            {inlineMenus.map((menu) => (
              <NavLink
                key={menu.path}
                to={menu.path}
                className={({ isActive }) => `shell-nav-item${isActive ? ' active' : ''}`}
              >
                {menu.label}
              </NavLink>
            ))}
            {overflowMenus.length > 0 && (
              <div className="shell-overflow-wrap" ref={overflowRef}>
                <button
                  className={`shell-nav-item${overflowOpen ? ' active' : ''}`}
                  onClick={() => setOverflowOpen(!overflowOpen)}
                >
                  更多 ▾
                </button>
                {overflowOpen && (
                  <div className="shell-overflow-dropdown">
                    {overflowMenus.map((menu) => (
                      <NavLink
                        key={menu.path}
                        to={menu.path}
                        className={({ isActive }) => `shell-overflow-item${isActive ? ' active' : ''}`}
                        onClick={() => setOverflowOpen(false)}
                      >
                        {menu.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )}
          </nav>
        </div>
        <div className="shell-topbar-right">
          <ThemeSwitcher />
          <span className="shell-user">{user.username}</span>
          <button className="shell-logout-btn" onClick={() => { logout(); navigate('/login'); }}>
            退出
          </button>
          <WindowControls />
        </div>
      </header>
      <main className="shell-content">
        <Outlet />
      </main>
    </div>
  );
}
