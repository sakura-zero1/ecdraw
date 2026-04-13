import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import type { UserRole } from '../../services/apiClient';

interface MenuItem {
  path: string;
  label: string;
  icon: string;
  roles: UserRole[];
}

const MENUS: MenuItem[] = [
  { path: '/components', label: '元件编辑', icon: '\u26A1', roles: ['ADMIN', 'COMPONENT_EDITOR', 'DIAGRAM_EDITOR'] },
  { path: '/diagrams', label: '图纸编辑', icon: '\uD83D\uDCC0', roles: ['ADMIN', 'DIAGRAM_EDITOR'] },
  { path: '/reviews', label: '图纸审核', icon: '\u2705', roles: ['ADMIN', 'REVIEWER'] },
  { path: '/viewer', label: '图纸查看', icon: '\uD83D\uDC41', roles: ['ADMIN', 'COMPONENT_EDITOR', 'DIAGRAM_EDITOR', 'REVIEWER', 'DISTRICT_EDITOR', 'LINE_EDITOR', 'GIS_EDITOR', 'VIEWER'] },
  { path: '/districts', label: '台区维护', icon: '\uD83C\uDFE0', roles: ['ADMIN', 'DIAGRAM_EDITOR', 'DISTRICT_EDITOR'] },
  { path: '/lines', label: '线路维护', icon: '\uD83D\uDD0C', roles: ['ADMIN', 'DIAGRAM_EDITOR', 'LINE_EDITOR'] },
  { path: '/gis', label: '地理维护', icon: '\uD83D\uDCCD', roles: ['ADMIN', 'DIAGRAM_EDITOR', 'GIS_EDITOR'] },
  { path: '/admin/dashboard', label: '数据概览', icon: '\uD83D\uDCCA', roles: ['ADMIN'] },
  { path: '/admin/users', label: '用户管理', icon: '\uD83D\uDC65', roles: ['ADMIN'] },
  { path: '/admin/audits', label: '审计日志', icon: '\uD83D\uDCCB', roles: ['ADMIN'] },
];

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const visibleMenus = MENUS.filter((m) => m.roles.some((r) => user.roles.includes(r)));

  return (
    <div className="shell">
      <aside className="shell-nav">
        <div className="shell-brand">ECDraw</div>
        <div className="shell-menu">
          {visibleMenus.map((menu) => (
            <NavLink
              key={menu.path}
              to={menu.path}
              className={({ isActive }) => `shell-menu-item ${isActive ? 'active' : ''}`}
            >
              <span className="menu-icon">{menu.icon}</span>
              {menu.label}
            </NavLink>
          ))}
        </div>
      </aside>
      <main className="shell-main">
        <header className="shell-topbar">
          <span>{user.username} ({user.roles.join(', ')})</span>
          <button className="btn btn-sm" onClick={() => { logout(); navigate('/login'); }}>
            退出登录
          </button>
        </header>
        <section className="shell-content">
          <Outlet />
        </section>
      </main>
    </div>
  );
}
