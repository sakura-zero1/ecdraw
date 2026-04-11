import { apiRequest, ensureApiAuth, type UserRole } from './apiClient';

export interface UserItem {
  id: string;
  username: string;
  role: UserRole;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt: string;
}

interface UserListResponse {
  items: UserItem[];
}

async function requireAuth() {
  const ok = await ensureApiAuth();
  if (!ok) throw new Error('未登录，无法访问 API');
}

export async function fetchUsers() {
  await requireAuth();
  return apiRequest<UserListResponse>('/api/users');
}

export async function createUser(payload: {
  username: string;
  password: string;
  role: UserRole;
  status?: 'ACTIVE' | 'DISABLED';
}) {
  await requireAuth();
  return apiRequest<UserItem>('/api/users', {
    method: 'POST',
    body: payload,
  });
}

export async function updateUser(
  id: string,
  payload: Partial<{ role: UserRole; status: 'ACTIVE' | 'DISABLED'; password: string }>
) {
  await requireAuth();
  return apiRequest<UserItem>(`/api/users/${id}`, {
    method: 'PATCH',
    body: payload,
  });
}
