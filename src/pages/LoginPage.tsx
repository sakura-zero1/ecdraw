import { useState } from 'react';
import WindowControls from '../components/layout/WindowControls';
import { parseError } from '../utils/parseError';

const isTauri = () => !!(window as any).__TAURI_INTERNALS__;

function tauriWindow() {
  if (!isTauri()) return null;
  return import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow());
}

function startDrag(e: React.MouseEvent) {
  if ((e.target as HTMLElement).closest('button, a, input, select, [role="button"]')) return;
  tauriWindow()?.then((w) => w?.startDragging());
}

function toggleMaximize() {
  tauriWindow()?.then((w) => w?.toggleMaximize());
}

function parseApiError(error: unknown) {
  const msg = parseError(error);
  const lower = msg.toLowerCase();
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return '无法连接 API（http://localhost:3001），请先启动后端：npm run api:dev';
  }
  return msg;
}

export default function LoginPage({ onSubmit }: { onSubmit: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Admin123456');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await onSubmit(username.trim(), password);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-titlebar" onMouseDown={startDrag} onDoubleClick={toggleMaximize}>
        <span className="shell-brand">EC<span className="shell-brand-accent">Draw</span></span>
        <WindowControls />
      </div>
      <form className="login-card" onSubmit={handleSubmit}>
        <h2>登录 ECDraw</h2>
        <label>
          用户名
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          密码
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <button className="btn btn-primary" disabled={loading}>
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  );
}
