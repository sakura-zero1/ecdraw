import { apiRequest, ensureApiAuth } from './apiClient';

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
  diagram: {
    id: string;
    name: string;
    status: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED';
    ownerId: string;
    currentVersionId: string | null;
  };
  diagramVersion: {
    id: string;
    versionNo: number;
    createdAt: string;
  };
}

interface ReviewQueueResponse {
  items: ReviewQueueItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface ReviewMutationResponse {
  updatedReview: ReviewQueueItem;
  updatedDiagram: {
    id: string;
    name: string;
    status: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED';
    currentVersionId: string | null;
  };
}

async function requireAuth() {
  const ok = await ensureApiAuth();
  if (!ok) {
    throw new Error('未登录，无法访问 API');
  }
}

export async function fetchReviewQueue(params: {
  status?: ReviewStatus;
  page?: number;
  pageSize?: number;
}) {
  await requireAuth();
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const queryText = query.toString();
  return apiRequest<ReviewQueueResponse>(`/api/reviews${queryText ? `?${queryText}` : ''}`);
}

export async function approveReviewByApi(id: string, comment?: string) {
  await requireAuth();
  return apiRequest<ReviewMutationResponse>(`/api/reviews/${id}/approve`, {
    method: 'POST',
    body: { comment },
  });
}

export async function rejectReviewByApi(id: string, comment?: string) {
  await requireAuth();
  return apiRequest<ReviewMutationResponse>(`/api/reviews/${id}/reject`, {
    method: 'POST',
    body: { comment },
  });
}
