# ECDraw UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform ECDraw from generic blue-themed UI to a minimalist, refined interface with top-bar navigation and rose accent color.

**Architecture:** Pure CSS + TSX layout changes. No new dependencies. Replace all hardcoded colors with CSS variables, restructure AppShell from left-sidebar to top-bar navigation, unify all page layouts.

**Tech Stack:** React 19 + TypeScript + plain CSS (no new libraries)

**Spec:** `docs/superpowers/specs/2026-04-17-ecdraw-ui-redesign.md`

---

## File Change Map

| File | Action | Responsibility |
|---|---|---|
| `index.html` | Modify | Add Google Fonts links |
| `src/index.css` | Rewrite | Global CSS variables, reset, base styles |
| `src/App.css` | Rewrite | AppShell topbar nav + login + all page-specific styles |
| `src/components/layout/AppShell.tsx` | Rewrite | Horizontal top-bar navigation |
| `src/components/layout/AppLayout.css` | Rewrite | Component editor layout + all shared component styles |
| `src/components/layout/AppLayout.tsx` | Modify | Remove independent topbar, fit into new AppShell |
| `src/pages/DiagramEditorPage.css` | Rewrite | Diagram editor layout |
| `src/pages/DiagramEditorPage.tsx` | Modify | Remove independent topbar |
| `src/pages/DiagramViewerPage.tsx` | Modify | Light sidebar, unified style |
| `src/components/canvas/ShapeToolbar.css` | Modify | Update to new color variables |
| `src/components/canvas/SvgCanvas.css` | Modify | Update to new color variables |

---

### Task 1: Add Google Fonts + Global CSS Variables

**Files:**
- Modify: `index.html`
- Rewrite: `src/index.css`

- [ ] **Step 1: Add Google Fonts to index.html**

Add these lines inside `<head>`, before the `<title>` tag:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000&display=swap" rel="stylesheet">
```

Also update `<title>` from `graph_prj2_temp` to `ECDraw`.

- [ ] **Step 2: Rewrite src/index.css with complete design system**

Replace the entire file content with the global CSS variables, reset, and base styles:

```css
/* ===== ECDraw Design System — Minimalist ===== */

:root {
  /* Gray Scale */
  --gray-900: #1a1a1a;
  --gray-700: #444444;
  --gray-500: #888888;
  --gray-400: #aaaaaa;
  --gray-300: #cccccc;
  --gray-200: #e5e5e5;
  --gray-100: #f0f0f0;
  --gray-50: #f5f5f5;
  --gray-25: #fafbfc;

  /* Accent — Rose */
  --accent: #e11d48;
  --accent-hover: #be123c;
  --accent-soft: rgba(225, 29, 72, 0.06);
  --accent-text: rgba(225, 29, 72, 0.85);

  /* Semantic */
  --success: #16a34a;
  --success-soft: #f0fdf4;
  --warning: #d97706;
  --warning-soft: #fffbeb;
  --danger: #dc2626;
  --danger-soft: #fef2f2;
  --info: #0284c7;

  /* Layout */
  --topbar-h: 40px;
  --sidebar-w: 200px;
  --panel-w: 260px;
  --radius-sm: 4px;
  --radius: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.08);

  /* Typography */
  --font-sans: 'DM Sans', 'PingFang SC', 'Noto Sans SC', sans-serif;
  --font-mono: 'Menlo', 'Consolas', monospace;
}

/* Reset */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--gray-900);
  background: var(--gray-25);
  overflow: hidden;
  height: 100vh;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#root {
  height: 100vh;
}

/* Base form elements */
input, select, textarea {
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--gray-900);
  background: var(--gray-25);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  padding: 7px 10px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

input:focus, select:focus, textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

textarea {
  resize: vertical;
  min-height: 60px;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--gray-300); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--gray-400); }
```

- [ ] **Step 3: Commit**

```bash
git add index.html src/index.css
git commit -m "feat(ui): add Google Fonts and global CSS design system variables"
```

---

### Task 2: Rewrite AppShell — Top-bar Navigation

**Files:**
- Rewrite: `src/components/layout/AppShell.tsx`
- Rewrite: `src/App.css`

This is the most significant structural change. The left sidebar navigation becomes a horizontal top-bar.

- [ ] **Step 1: Rewrite src/components/layout/AppShell.tsx**

Replace the entire file. Key changes:
- Remove `navCollapsed` state, remove left sidebar
- Navigation becomes horizontal tabs in the topbar
- Add overflow handling: visible items shown inline, overflow items in "更多" dropdown
- User info and logout on the right side of the topbar

```tsx
import { useRef, useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import type { UserRole } from '../../services/apiClient';

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

  // Split: first 7 items inline, rest in overflow dropdown
  // For admin users with many items, use 6 inline
  const maxInline = visibleMenus.length > 8 ? 6 : 7;
  const inlineMenus = visibleMenus.slice(0, maxInline);
  const overflowMenus = visibleMenus.slice(maxInline);

  return (
    <div className="shell">
      <header className="shell-topbar">
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
          <span className="shell-user">{user.username}</span>
          <button className="shell-logout-btn" onClick={() => { logout(); navigate('/login'); }}>
            退出
          </button>
        </div>
      </header>
      <main className="shell-content">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite src/App.css**

Remove all old sidebar/shell styles. Write new topbar + login + page-specific styles:

```css
/* ===== AppShell — Top-bar Navigation ===== */

.shell {
  display: grid;
  grid-template-rows: var(--topbar-h) 1fr;
  height: 100vh;
}

.shell-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid var(--gray-200);
  position: relative;
  z-index: 100;
}

.shell-topbar-left {
  display: flex;
  align-items: center;
  gap: 20px;
}

.shell-brand {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.3px;
  color: var(--gray-900);
  white-space: nowrap;
}

.shell-brand-accent {
  color: var(--accent);
}

.shell-nav {
  display: flex;
  align-items: center;
  gap: 2px;
}

.shell-nav-item {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--gray-500);
  border-radius: var(--radius);
  cursor: pointer;
  background: none;
  border: none;
  font-family: var(--font-sans);
  white-space: nowrap;
  text-decoration: none;
  transition: background 0.12s, color 0.12s;
}

.shell-nav-item:hover {
  background: var(--gray-50);
  color: var(--gray-700);
}

.shell-nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

/* Overflow dropdown */
.shell-overflow-wrap {
  position: relative;
}

.shell-overflow-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: 4px;
  min-width: 120px;
  z-index: 200;
}

.shell-overflow-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--gray-500);
  border-radius: var(--radius);
  cursor: pointer;
  background: none;
  border: none;
  font-family: var(--font-sans);
  text-decoration: none;
  transition: background 0.12s, color 0.12s;
}

.shell-overflow-item:hover {
  background: var(--gray-50);
  color: var(--gray-700);
}

.shell-overflow-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

/* Topbar right */
.shell-topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.shell-user {
  font-size: 12px;
  color: var(--gray-400);
  font-weight: 500;
}

.shell-logout-btn {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--gray-500);
  background: none;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  cursor: pointer;
  font-family: var(--font-sans);
  transition: all 0.12s;
}

.shell-logout-btn:hover {
  background: var(--gray-50);
  color: var(--gray-700);
  border-color: var(--gray-300);
}

/* Content area */
.shell-content {
  min-height: 0;
  overflow: auto;
  background: var(--gray-25);
}

/* ===== Login Screen ===== */

.login-screen {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gray-25);
}

.login-card {
  width: 340px;
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-lg);
  padding: 32px 28px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.login-card h2 {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.3px;
  color: var(--gray-900);
}

.login-card label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10px;
  font-weight: 700;
  color: var(--gray-500);
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

.login-card input {
  width: 100%;
}

.form-error {
  border: 1px solid #fecaca;
  color: var(--danger);
  background: var(--danger-soft);
  border-radius: var(--radius);
  padding: 8px 10px;
  font-size: 12px;
}

/* ===== Workspace Page (common) ===== */

.workspace-page {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.page-head h3 {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.3px;
}

.page-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card {
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  padding: 12px;
}

/* Page component full-height */
.page-component {
  height: 100%;
}

.page-component .app-layout {
  height: calc(100vh - var(--topbar-h));
}

/* ===== Buttons ===== */

.btn {
  padding: 6px 12px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  background: #fff;
  color: var(--gray-700);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-sans);
  transition: all 0.12s;
}

.btn:hover {
  background: var(--gray-50);
  border-color: var(--gray-300);
  color: var(--gray-900);
}

.btn-sm {
  padding: 3px 8px;
  font-size: 11px;
}

.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn-primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
  color: #fff;
}

.btn-primary:disabled {
  background: var(--gray-400);
  border-color: var(--gray-400);
  cursor: not-allowed;
  opacity: 0.7;
}

.btn-danger {
  color: var(--danger);
  border-color: #fecaca;
}

.btn-danger:hover {
  background: var(--danger-soft);
  border-color: #fca5a5;
  color: var(--danger);
}

/* ===== Tags / Badges ===== */

.review-status {
  font-size: 10px;
  font-weight: 700;
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  letter-spacing: 0.3px;
}

.review-status.pending {
  background: var(--warning-soft);
  color: var(--warning);
}

.review-status.approved,
.review-status.published {
  background: var(--success-soft);
  color: var(--success);
}

.review-status.rejected {
  background: var(--danger-soft);
  color: var(--danger);
}

.review-status.draft {
  background: var(--gray-50);
  color: var(--gray-500);
}

/* ===== Review Page ===== */

.review-list {
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  background: #fff;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.review-item {
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  padding: 10px;
}

.review-item-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.review-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: var(--gray-500);
  font-size: 12px;
  margin-bottom: 6px;
}

.review-actions {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
}

.review-result {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--gray-700);
}

.review-preview-area {
  width: 100%;
  height: 300px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  margin-top: 12px;
  background: var(--gray-25);
}

/* ===== Published / Data Layout ===== */

.published-layout {
  display: grid;
  grid-template-columns: var(--sidebar-w) 1fr;
  gap: 12px;
  min-height: 520px;
}

.published-list {
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  background: #fff;
  overflow: auto;
  padding: 8px;
}

.published-item {
  width: 100%;
  text-align: left;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  background: #fff;
  padding: 8px 10px;
  margin-bottom: 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--gray-900);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.12s;
}

.published-item:last-child {
  margin-bottom: 0;
}

.published-item span {
  color: var(--gray-400);
  font-size: 11px;
}

.published-item:hover {
  background: var(--gray-50);
  border-color: var(--gray-300);
}

.published-item.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.published-preview {
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  background: #fff;
  display: flex;
  flex-direction: column;
  min-height: 520px;
  overflow: hidden;
}

.published-preview-meta {
  padding: 8px 10px;
  border-bottom: 1px solid var(--gray-200);
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--gray-700);
}

/* ===== Readonly Diagram Preview ===== */

.readonly-diagram-root {
  flex: 1;
  overflow: auto;
  background:
    linear-gradient(var(--gray-100) 1px, transparent 1px),
    linear-gradient(90deg, var(--gray-100) 1px, transparent 1px);
  background-size: 20px 20px;
}

.readonly-diagram-stage {
  position: relative;
  width: 2400px;
  height: 1400px;
}

.readonly-lines {
  position: absolute;
  inset: 0;
}

.readonly-node {
  position: absolute;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  border-radius: var(--radius);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  padding: 6px;
  text-align: center;
}

/* ===== Viewer Page ===== */

.viewer-layout {
  display: flex;
  flex-direction: row;
  gap: 0;
  flex: 1;
  min-height: 0;
  height: calc(100vh - var(--topbar-h) - 46px);
}

.viewer-sidebar {
  width: var(--sidebar-w);
  min-width: var(--sidebar-w);
  background: #fff;
  border-radius: var(--radius-md);
  border: 1px solid var(--gray-200);
  padding: 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.viewer-sidebar-title {
  color: var(--gray-500);
  font-size: 10px;
  font-weight: 700;
  padding: 6px 8px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

.viewer-diagram-item {
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--gray-700);
  font-size: 13px;
  font-weight: 500;
  font-family: var(--font-sans);
  transition: all 0.12s;
}

.viewer-diagram-item:hover {
  background: var(--gray-50);
}

.viewer-diagram-item.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.viewer-diagram-item strong {
  font-size: 13px;
  font-weight: 600;
  color: inherit;
}

.viewer-diagram-item span {
  color: var(--gray-400);
  font-size: 11px;
}

.viewer-empty-hint {
  color: var(--gray-400);
  font-size: 13px;
  text-align: center;
  padding: 24px 12px;
}

.viewer-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: #fff;
  border: 1px solid var(--gray-200);
  margin-left: 12px;
}

.viewer-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--gray-200);
  background: #fff;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.viewer-mode-tabs {
  display: flex;
  gap: 2px;
  background: var(--gray-50);
  border-radius: var(--radius);
  padding: 2px;
}

.viewer-toolbar-btn {
  border: 1px solid var(--gray-200);
  background: #fff;
  border-radius: var(--radius);
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: var(--gray-700);
  white-space: nowrap;
  font-family: var(--font-sans);
  transition: all 0.12s;
}

.viewer-toolbar-btn:hover {
  background: var(--gray-50);
}

.viewer-toolbar-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.viewer-toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.viewer-toolbar-btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.viewer-toolbar-btn-primary:hover {
  background: var(--accent-hover);
}

.viewer-toolbar-btn-primary:disabled {
  background: var(--gray-400);
  border-color: var(--gray-400);
  opacity: 0.7;
}

.viewer-toolbar-sep {
  width: 1px;
  height: 20px;
  background: var(--gray-200);
  margin: 0 4px;
}

.sim-active {
  background: var(--warning-soft);
  color: var(--warning);
  border-radius: var(--radius);
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
}

.sim-selected-label {
  font-size: 12px;
  color: var(--gray-500);
  padding: 4px 8px;
}

.viewer-canvas-area {
  flex: 1;
  min-height: 0;
  position: relative;
  background: var(--gray-25);
}

.viewer-stats {
  width: var(--panel-w);
  min-width: var(--panel-w);
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  padding: 12px;
  margin-left: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.viewer-stats h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--gray-900);
  border-bottom: 2px solid var(--danger);
  padding-bottom: 8px;
}

.viewer-stats h5 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--gray-500);
}

.viewer-stats-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--gray-50);
}

.viewer-stats-label {
  font-size: 12px;
  color: var(--gray-500);
}

.viewer-stats-value {
  font-size: 20px;
  font-weight: 700;
}

.viewer-stats-value-danger {
  color: var(--danger);
}

.viewer-stats-section {
  border-top: 1px solid var(--gray-100);
  padding-top: 10px;
}

.viewer-stats-empty {
  color: var(--gray-400);
  font-size: 12px;
  padding: 4px 0;
}

.viewer-stats-districts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.viewer-stats-districts li {
  background: var(--danger-soft);
  border: 1px solid #fecaca;
  border-radius: var(--radius);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.viewer-stats-districts li strong {
  font-size: 12px;
  color: #991b1b;
}

.viewer-stats-districts li span {
  font-size: 11px;
  color: var(--danger);
}

.viewer-stats-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.viewer-stats-tag {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
}

.viewer-stats-tag-ok {
  background: var(--success-soft);
  color: var(--success);
}

.viewer-stats-tag-danger {
  background: var(--danger-soft);
  color: #991b1b;
}

.diagram-viewer-page {
  height: calc(100vh - var(--topbar-h));
}

/* ===== Dashboard ===== */

.dashboard-stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin: 16px 0;
}

.stat-card {
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  padding: 16px;
}

.stat-card-label {
  font-size: 11px;
  color: var(--gray-500);
  margin-bottom: 4px;
}

.stat-card-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--gray-900);
}

.dashboard-section {
  display: flex;
  gap: 16px;
  margin-top: 16px;
}

.dashboard-status-chart,
.dashboard-recent {
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  padding: 16px;
  flex: 1;
}

.dashboard-recent h4 { margin: 0 0 12px; font-size: 13px; font-weight: 700; }

.dashboard-recent-item {
  display: flex;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--gray-50);
  font-size: 12px;
  color: var(--gray-500);
}

.dashboard-recent-item:last-child { border-bottom: none; }
.dashboard-recent-time { color: var(--gray-400); min-width: 80px; }
.dashboard-recent-user { color: var(--gray-900); font-weight: 600; min-width: 60px; }
.dashboard-recent-action { color: var(--accent); }

.status-bar { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.status-bar-label { min-width: 80px; font-size: 12px; color: var(--gray-500); }
.status-bar-track { flex: 1; height: 20px; background: var(--gray-50); border-radius: var(--radius-sm); overflow: hidden; }
.status-bar-fill { height: 100%; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: flex-end; padding-right: 6px; font-size: 10px; color: #fff; font-weight: 600; }
.status-bar-fill.draft { background: var(--gray-400); }
.status-bar-fill.pending { background: var(--warning); }
.status-bar-fill.published { background: var(--success); }
.status-bar-fill.rejected { background: var(--danger); }

/* ===== Audit ===== */

.audit-summary { display: flex; gap: 16px; margin-bottom: 16px; }
.audit-summary-card { background: #fff; border: 1px solid var(--gray-200); border-radius: var(--radius-md); padding: 12px 20px; }
.audit-summary-label { font-size: 11px; color: var(--gray-500); }
.audit-summary-value { font-size: 20px; font-weight: 700; color: var(--gray-900); }

/* ===== Responsive ===== */

@media (max-width: 900px) {
  .shell-nav {
    display: none;
  }

  .viewer-layout {
    flex-direction: column;
  }

  .viewer-sidebar {
    width: 100%;
    min-width: 0;
    max-height: 160px;
  }

  .viewer-stats {
    width: 100%;
    min-width: 0;
    margin-left: 0;
    margin-top: 12px;
  }

  .published-layout {
    grid-template-columns: 1fr;
    min-height: 0;
  }

  .dashboard-stats {
    grid-template-columns: repeat(3, 1fr);
  }

  .dashboard-section {
    flex-direction: column;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppShell.tsx src/App.css
git commit -m "feat(ui): rewrite AppShell to top-bar navigation with minimalist style"
```

---

### Task 3: Rewrite Component Editor Layout (AppLayout)

**Files:**
- Rewrite: `src/components/layout/AppLayout.css`
- Modify: `src/components/layout/AppLayout.tsx`

The component editor removes its independent topbar and fits into the AppShell topbar. Left sidebar shrinks to 200px, right panel to 260px. All styles use new CSS variables.

- [ ] **Step 1: Rewrite src/components/layout/AppLayout.css**

Replace the entire file. Move all shared component styles (buttons, inputs, dialogs, tables, etc.) to use new variables. Remove the toolbar styles. Key changes:
- `--sidebar-width: 200px`, `--panel-width: 260px`
- Remove `.toolbar` styles (AppShell handles topbar now)
- `.app-layout` no longer has topbar row — just the 3-column grid
- All colors reference new CSS variables

The full file should contain:
- Layout grid: `.app-layout` with `grid-template-columns: var(--sidebar-w) 1fr var(--panel-w)`
- Sidebar styles: `.sidebar`, `.sidebar-header`, `.sidebar-search`, `.component-list`, `.category-group`, `.category-header`, `.component-item`
- Canvas area: `.canvas-area`
- Panel styles: `.panel`, `.panel-top`, `.panel-tabs`, `.panel-body`, `.panel-section`
- All dialog, table, pin, matrix, toggle, state-override, conn-detail styles
- Collapsible panel button styles (`ce-panel-header-btn`, `ce-panel-expand-btn`)
- All using `var(--gray-*)`, `var(--accent-*)`, `var(--radius-*)`, etc.

- [ ] **Step 2: Modify src/components/layout/AppLayout.tsx**

Key changes to the component:
- Remove the `<header className="toolbar">` section entirely (move save/refresh/export/import buttons into sidebar header or as a floating toolbar)
- `.app-layout` no longer has `flex-direction: column` — it's just the 3-column grid that fills `calc(100vh - var(--topbar-h))`
- Adjust main-content collapsed classes to use new widths

Specifically:
1. Remove the toolbar header div and its state variables (`saving`, `syncStatus` shown in toolbar)
2. Add save/refresh buttons to the sidebar header area
3. Change `.app-layout` to use `height: 100%` without toolbar
4. Update `.main-content` grid to `var(--sidebar-w) 1fr var(--panel-w)`

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppLayout.css src/components/layout/AppLayout.tsx
git commit -m "feat(ui): rewrite component editor layout with unified design system"
```

---

### Task 4: Rewrite Diagram Editor Layout

**Files:**
- Rewrite: `src/pages/DiagramEditorPage.css`
- Modify: `src/pages/DiagramEditorPage.tsx`

Same approach as Task 3 — remove independent topbar, use new variables.

- [ ] **Step 1: Rewrite src/pages/DiagramEditorPage.css**

Replace all hardcoded colors with CSS variables. Grid: `var(--sidebar-w) 1fr var(--panel-w)`. Collapsed: `32px 1fr var(--panel-w)` etc. Remove `.de-topbar` styles.

- [ ] **Step 2: Modify src/pages/DiagramEditorPage.tsx**

Remove the `.de-topbar` header section. Move save/zoom/title into the AppShell topbar or into the canvas area as a floating toolbar. The layout becomes just the 3-column grid under AppShell.

- [ ] **Step 3: Commit**

```bash
git add src/pages/DiagramEditorPage.css src/pages/DiagramEditorPage.tsx
git commit -m "feat(ui): rewrite diagram editor layout with unified design system"
```

---

### Task 5: Update Canvas Component Styles

**Files:**
- Modify: `src/components/canvas/ShapeToolbar.css`
- Modify: `src/components/canvas/SvgCanvas.css`

- [ ] **Step 1: Update ShapeToolbar.css**

Replace hardcoded colors with CSS variables:
- `#d6e0ed` → `var(--gray-200)`
- `#304256` → `var(--gray-700)`
- `#f2f8fd` → `var(--gray-50)`
- `#c8dbef` → `var(--gray-300)`
- `#eaf6fd` → `var(--accent-soft)`
- `#0369a1` → `var(--accent)`
- `#7dd3fc` → `var(--accent)`
- `#dbe7f4` → `var(--gray-200)`
- `#607286` → `var(--gray-500)`
- `box-shadow` → `var(--shadow)`
- `border-radius` → `var(--radius-md)`

- [ ] **Step 2: Update SvgCanvas.css**

Replace hardcoded colors with CSS variables:
- `#d6e0ed` → `var(--gray-200)`
- `background` gradient → `var(--gray-25)`
- `box-shadow` values → `var(--shadow)`
- `#f2f8fd` → `var(--gray-50)`
- `#607286` → `var(--gray-500)`
- `#2e4154` → `var(--gray-700)`
- `#c8dbef` → `var(--gray-300)`

- [ ] **Step 3: Commit**

```bash
git add src/components/canvas/ShapeToolbar.css src/components/canvas/SvgCanvas.css
git commit -m "feat(ui): update canvas component styles to use design system variables"
```

---

### Task 6: Final Polish + Visual Verification

**Files:**
- Potentially all modified files for minor adjustments

- [ ] **Step 1: Start dev server and verify visually**

Run: `npm run dev`
Open the app in browser. Check every page:
- Login page: clean card, rose button
- Component editor: no double toolbar, unified sidebar/panel
- Diagram editor: same
- Viewer: light sidebar (not dark)
- Review page: clean list with status badges
- Data pages: unified layout
- Admin pages: clean dashboard

- [ ] **Step 2: Fix any visual issues found**

Common issues to watch for:
- Double topbars (old editor topbar not fully removed)
- Missing buttons (save/export moved from old toolbar)
- Color mismatches (hardcoded values missed)
- Layout breaks (grid widths need tweaking)
- Font not loading (Google Fonts link missing or blocked)

- [ ] **Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix(ui): polish visual details and fix layout issues"
```

---

## Notes for Implementer

1. **AppLayout.css is the "master" stylesheet** — it contains buttons, inputs, dialogs, tables, and many shared component styles. When rewriting it, ALL of these shared styles must be preserved and updated to use new variables. Do NOT delete any class — only change the color/spacing/shadow values.

2. **AppShell.tsx rewrite is the biggest structural change.** The entire left sidebar disappears. All 10 menu items go into a horizontal topbar. Test that role-based filtering still works.

3. **The editor pages (AppLayout.tsx, DiagramEditorPage.tsx) both have their own toolbars.** These must be removed or adapted. The toolbar buttons (save, refresh, export, import, zoom) need to go somewhere — either into the AppShell topbar (right side) or as a floating toolbar within the canvas area.

4. **No business logic changes.** Only CSS values and layout markup. Do not touch stores, services, or backend code.

5. **The DiagramViewerPage has its CSS classes defined in App.css** (not a separate file). The rewrite of App.css in Task 2 already covers these viewer styles.
