import { apiRequest, ensureApiAuth } from './apiClient';

export interface AuditItem {
  id: string;
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  payload: unknown;
  createdAt: string;
  user: {
    id: string;
    username: string;
    role: string;
  };
}

interface AuditResponse {
  items: AuditItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

async function requireAuth() {
  const ok = await ensureApiAuth();
  if (!ok) {
    throw new Error('未登录，无法访问 API');
  }
}

export async function fetchAuditLogs(params: {
  action?: string;
  targetType?: string;
  targetId?: string;
  page?: number;
  pageSize?: number;
}) {
  await requireAuth();
  const query = new URLSearchParams();
  if (params.action) query.set('action', params.action);
  if (params.targetType) query.set('targetType', params.targetType);
  if (params.targetId) query.set('targetId', params.targetId);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const queryText = query.toString();
  return apiRequest<AuditResponse>(`/api/audits${queryText ? `?${queryText}` : ''}`);
}
