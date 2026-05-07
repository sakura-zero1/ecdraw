import { tauriRequest, ensureTauriAuth, type UserRole } from './tauriClient';

export interface UserItem {
  id: string;
  username: string;
  roles: string[];
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt: string;
}

async function requireAuth() {
  const ok = await ensureTauriAuth();
  if (!ok) throw new Error('未登录，无法访问 API');
}

export async function fetchUsers() {
  await requireAuth();
  return tauriRequest<UserItem[]>('list_users');
}

export async function createUser(payload: {
  username: string;
  password: string;
  roles: UserRole[];
  status?: 'ACTIVE' | 'DISABLED';
}) {
  await requireAuth();
  return tauriRequest<UserItem>('create_user', payload);
}

export async function updateUser(
  id: string,
  payload: Partial<{ roles: UserRole[]; status: 'ACTIVE' | 'DISABLED'; password: string }>
) {
  await requireAuth();
  return tauriRequest<UserItem>('update_user', { id, ...payload });
}
