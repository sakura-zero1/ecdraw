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

const ROLES: UserRole[] = ['ADMIN', 'COMPONENT_EDITOR', 'DIAGRAM_EDITOR', 'REVIEWER', 'VIEWER'];

export default function UserManagementPage() {
  const [items, setItems] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    username: '',
    password: '',
    role: 'VIEWER' as UserRole,
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

  const handleCreate = async () => {
    if (!form.username.trim() || !form.password) return;
    setError('');
    try {
      await createUser({
        username: form.username.trim(),
        password: form.password,
        role: form.role,
        status: 'ACTIVE',
      });
      setForm({ username: '', password: '', role: 'VIEWER' });
      await load();
    } catch (e) {
      setError(parseApiError(e));
    }
  };

  return (
    <div className="workspace-page">
      <div className="page-head">
        <h3>用户管理</h3>
      </div>

      <div className="card">
        <div className="form-row">
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
          <select value={form.role} onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as UserRole }))}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={() => void handleCreate()}>
            新建用户
          </button>
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
                <td>{item.role}</td>
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
