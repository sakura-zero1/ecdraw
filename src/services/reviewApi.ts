import { request, ensureAuth } from './unifiedClient';

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ReviewFilterStatus = ReviewStatus | 'ALL';

export interface ReviewQueueItem {
  id: string;
  diagramId: string;
  diagramVersionId: string;
  submitterId: string;
  reviewerId: string | null;
  status: ReviewStatus;
  comment: string | null;
  submittedAt: string;
  reviewedAt: string | null;
}

async function requireAuth() {
  const ok = await ensureAuth();
  if (!ok) throw new Error('未登录，无法访问 API');
}

export async function fetchReviewQueue(params: {
  status?: ReviewStatus;
  page?: number;
  pageSize?: number;
}) {
  await requireAuth();
  return request<{
    items: ReviewQueueItem[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }>('list_reviews', {
    status: params.status,
    page: params.page,
    page_size: params.pageSize,
  });
}

export async function approveReviewByApi(id: string, comment?: string) {
  await requireAuth();
  return request('approve_review', { id, comment });
}

export async function rejectReviewByApi(id: string, comment?: string) {
  await requireAuth();
  return request('reject_review', { id, comment });
}
