import { useEffect, useState } from 'react';
import type { UserRole } from '../services/apiClient';
import { createUser, fetchUsers, type UserItem } from '../services/userApi';

function parseApiError(error: unknown) {
  if (!(error instanceof Error)) return '请求失败';
  try {
    const payload = JSON.parse(error.message) as { message?: string };
    return payload.message || error.message;
  } catch {
    return error.message || '请求失败';
  }
}

const ROLES: UserRole[] = ['ADMIN', 'COMPONENT_EDITOR', 'DIAGRAM_EDITOR', 'REVIEWER', 'DISTRICT_EDITOR', 'LINE_EDITOR', 'GIS_EDITOR', 'VIEWER'];

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: '管理员',
  COMPONENT_EDITOR: '元件设计员',
  DIAGRAM_EDITOR: '图纸设计员',
  REVIEWER: '审核员',
  DISTRICT_EDITOR: '台区维护员',
  LINE_EDITOR: '线路维护员',
  GIS_EDITOR: '地理维护员',
  VIEWER: '查看者',
};

export default function UserManagementPage() {
  const [items, setItems] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    username: '',
    password: '',
    roles: ['VIEWER'] as UserRole[],
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchUsers();
      setItems(result.items);
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleRole = (role: UserRole) => {
    setForm((prev) => {
      const next = prev.roles.includes(role)
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role];
      return { ...prev, roles: next.length === 0 ? [role] : next };
    });
  };

  const handleCreate = async () => {
    if (!form.username.trim() || !form.password || form.roles.length === 0) return;
    setError('');
    try {
      await createUser({
        username: form.username.trim(),
        password: form.password,
        roles: form.roles,
        status: 'ACTIVE',
      });
      setForm({ username: '', password: '', roles: ['VIEWER'] });
      await load();
    } catch (e) {
      setError(parseApiError(e));
    }
  };

  const formatRoles = (roles: string[]) =>
    roles.map((r) => ROLE_LABELS[r as UserRole] ?? r).join(', ');

  return (
    <div className="workspace-page">
      <div className="page-head">
        <h3>用户管理</h3>
      </div>

      <div className="card">
        <div className="form-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <input
            placeholder="用户名"
            value={form.username}
            onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
          />
          <input
            type="password"
            placeholder="密码"
            value={form.password}
            onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
          />
          <button className="btn btn-primary" onClick={() => void handleCreate()}>
            新建用户
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
          {ROLES.map((role) => (
            <label key={role} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.roles.includes(role)}
                onChange={() => toggleRole(role)}
              />
              {ROLE_LABELS[role]}
            </label>
          ))}
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="card">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>用户名</th>
              <th>角色</th>
              <th>状态</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.username}</td>
                <td>{formatRoles(item.roles)}</td>
                <td>{item.status}</td>
                <td>{new Date(item.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 ? <div className="empty-hint">暂无用户</div> : null}
      </div>
    </div>
  );
}
