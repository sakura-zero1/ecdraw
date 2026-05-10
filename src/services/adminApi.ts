import { request, ensureAuth } from './unifiedClient';

async function requireAuth() {
  const ok = await ensureAuth();
  if (!ok) throw new Error('未登录');
}

export interface DashboardData {
  userCount: number;
  componentCount: number;
  diagramCount: number;
  publishedCount: number;
  pendingReviewCount: number;
  instanceCount: number;
  edgeCount: number;
  districtDataCount: number;
  lineDataCount: number;
  gisDataCount: number;
  diagramsByStatus: Array<{ status: string; count: number }>;
  recentAudits: Array<{
    id: string;
    userId: string;
    action: string;
    targetType: string;
    targetId: string;
    createdAt: string;
    user: { username: string };
  }>;
}

export async function fetchDashboard(): Promise<DashboardData> {
  await requireAuth();
  return request<DashboardData>('dashboard_stats');
}
