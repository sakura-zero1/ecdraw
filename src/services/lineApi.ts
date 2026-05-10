import { request, ensureAuth } from './unifiedClient';

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
  const ok = await ensureAuth();
  if (!ok) throw new Error('未登录');
}

export async function fetchLinesByDiagram(diagramId: string): Promise<LineSegmentData[]> {
  await requireAuth();
  return request<LineSegmentData[]>('list_lines_by_diagram', { diagram_id: diagramId });
}

export async function upsertLineSegment(edgeId: string, data: Partial<Omit<LineSegmentData, 'id' | 'diagramEdgeId' | 'updatedBy' | 'createdAt' | 'updatedAt'>>): Promise<LineSegmentData> {
  await requireAuth();
  return request<LineSegmentData>('upsert_line', {
    edge_id: edgeId,
    length: data.length,
    wire_model: data.wireModel,
    wire_ownership: data.wireOwnership,
    wire_type: data.wireType,
    is_main_display: data.isMainDisplay,
  });
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
  const itemsForRust = items.map(item => ({
    diagram_edge_id: item.diagramEdgeId,
    length: item.length,
    wire_model: item.wireModel,
    wire_ownership: item.wireOwnership,
    wire_type: item.wireType,
    is_main_display: item.isMainDisplay,
  }));
  return request<{ count: number }>('batch_upsert_lines', { items: itemsForRust });
}
