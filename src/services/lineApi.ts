import { apiRequest, ensureApiAuth } from './apiClient';

export interface LineSegmentEdge {
  id: string;
  sourceInstanceId: string;
  targetInstanceId: string;
  sourcePinId: string;
  targetPinId: string;
}

export type WireOwnership = 'user' | 'public';
export type WireType = 'overhead' | 'cable';

export interface LineSegmentData {
  id: string;
  diagramEdgeId: string;
  length: number | null;
  wireModel: string | null;
  wireOwnership: WireOwnership | null;
  wireType: WireType | null;
  isMainDisplay: boolean | null;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  diagramEdge?: LineSegmentEdge;
}

async function requireAuth(): Promise<void> {
  const ok = await ensureApiAuth();
  if (!ok) throw new Error('未登录');
}

export async function fetchLinesByDiagram(diagramId: string): Promise<LineSegmentData[]> {
  await requireAuth();
  const res = await apiRequest<{ items: LineSegmentData[] }>(`/api/lines/diagram/${diagramId}`);
  return res.items;
}

export async function upsertLineSegment(edgeId: string, data: Partial<Omit<LineSegmentData, 'id' | 'diagramEdgeId' | 'updatedBy' | 'createdAt' | 'updatedAt'>>): Promise<LineSegmentData> {
  await requireAuth();
  return apiRequest<LineSegmentData>(`/api/lines/edge/${edgeId}`, { method: 'PUT', body: data });
}

export async function batchUpsertLineSegments(items: Array<{
  diagramEdgeId: string;
  length?: number | null;
  wireModel?: string | null;
  wireOwnership?: WireOwnership | null;
  wireType?: WireType | null;
  isMainDisplay?: boolean | null;
}>): Promise<{ count: number }> {
  await requireAuth();
  return apiRequest<{ count: number }>('/api/lines/batch', { method: 'POST', body: { items } });
}
