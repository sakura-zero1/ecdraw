import { request, ensureAuth } from './unifiedClient';

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
  const ok = await ensureAuth();
  if (!ok) throw new Error('未登录，无法访问 API');
}

export async function fetchAuditLogs(params: {
  action?: string;
  targetType?: string;
  targetId?: string;
  page?: number;
  pageSize?: number;
}) {
  await requireAuth();
  return request<AuditResponse>('list_audits', {
    action: params.action,
    target_type: params.targetType,
    target_id: params.targetId,
    page: params.page,
    page_size: params.pageSize,
  });
}
