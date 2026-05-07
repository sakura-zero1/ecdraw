import { tauriRequest, ensureTauriAuth } from './tauriClient';

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
  const ok = await ensureTauriAuth();
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
  return tauriRequest<AuditResponse>('list_audits', {
    action: params.action,
    target_type: params.targetType,
    target_id: params.targetId,
    page: params.page,
    page_size: params.pageSize,
  });
}
