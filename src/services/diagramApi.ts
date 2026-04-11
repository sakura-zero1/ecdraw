import { apiRequest, ensureApiAuth } from './apiClient';

export type DiagramStatus = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED';

export interface DiagramListItem {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  status: DiagramStatus;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiagramInstance {
  id: string;
  componentId: string;
  componentVersionId: string;
  label: string;
  x: number;
  y: number;
  rotation?: number;
  scale?: number;
}

export interface DiagramConnection {
  id: string;
  fromInstanceId: string;
  fromPinId: string;
  toInstanceId: string;
  toPinId: string;
  state: 'open' | 'closed';
  visible: boolean;
  label: string;
}

export interface DiagramSnapshot {
  schemaVersion: number;
  instances: DiagramInstance[];
  connections: DiagramConnection[];
  selection: { instanceIds: string[]; connectionIds: string[] };
  viewport: { zoom: number; panX: number; panY: number };
}

interface DiagramListResponse {
  items: DiagramListItem[];
}

interface DiagramEditorResponse {
  diagram: DiagramListItem;
  versionNo: number;
  snapshot: DiagramSnapshot;
}

async function requireAuth() {
  const ok = await ensureApiAuth();
  if (!ok) {
    throw new Error('未登录，无法访问 API');
  }
}

export async function fetchPublishedDiagrams() {
  await requireAuth();
  const response = await apiRequest<DiagramListResponse>('/api/diagrams');
  return response.items.filter((item) => item.status === 'PUBLISHED');
}

export async function fetchDiagrams() {
  await requireAuth();
  const response = await apiRequest<DiagramListResponse>('/api/diagrams');
  return response.items;
}

export async function createDiagramByApi(name: string, description = '') {
  await requireAuth();
  return apiRequest<DiagramListItem>('/api/diagrams', {
    method: 'POST',
    body: { name, description },
  });
}

export async function submitDiagramReview(diagramId: string) {
  await requireAuth();
  return apiRequest(`/api/diagrams/${diagramId}/submit-review`, {
    method: 'POST',
  });
}

export async function fetchDiagramReadonlySnapshot(diagramId: string) {
  await requireAuth();
  return apiRequest<DiagramEditorResponse>(`/api/diagrams/${diagramId}/editor`);
}
