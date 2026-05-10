import { request, ensureAuth, type UserRole } from './unifiedClient';

export interface UserItem {
  id: string;
  username: string;
  roles: string[];
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt: string;
}

async function requireAuth() {
  const ok = await ensureAuth();
  if (!ok) throw new Error('未登录，无法访问 API');
}

export async function fetchUsers() {
  await requireAuth();
  return request<UserItem[]>('list_users');
}

export async function createUser(payload: {
  username: string;
  password: string;
  roles: UserRole[];
  status?: 'ACTIVE' | 'DISABLED';
}) {
  await requireAuth();
  return request<UserItem>('create_user', payload);
}

export async function updateUser(
  id: string,
  payload: Partial<{ roles: UserRole[]; status: 'ACTIVE' | 'DISABLED'; password: string }>
) {
  await requireAuth();
  return request<UserItem>('update_user', { id, ...payload });
}
