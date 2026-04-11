import { useState } from 'react';

interface Props {
  loading?: boolean;
  error?: string;
  onSubmit: (username: string, password: string) => Promise<void>;
}

export default function LoginPage({ loading = false, error = '', onSubmit }: Props) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Admin123456');

  return (
    <div className="login-screen">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(username.trim(), password);
        }}
      >
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
