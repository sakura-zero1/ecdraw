import { apiRequest, ensureApiAuth } from './apiClient';

export type DiagramStatus = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'PENDING_DELETE';

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
  diagramId: string;
  componentId: string;
  label: string;
  positionX: number;
  positionY: number;
  instanceData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Legacy snapshot instance format (stored in DiagramVersion.snapshot JSON) */
export interface SnapshotInstance {
  id: string;
  componentId: string;
  componentVersionId?: string;
  label: string;
  x: number;
  y: number;
  rotation?: number;
  scale?: number;
}

/** Legacy snapshot connection format (stored in DiagramVersion.snapshot JSON) */
export interface SnapshotConnection {
  id: string;
  fromInstanceId: string;
  fromPinId: string;
  toInstanceId: string;
  toPinId: string;
  state: 'open' | 'closed';
  visible: boolean;
  label: string;
}

export interface DiagramEdge {
  id: string;
  diagramId: string;
  sourceInstanceId: string;
  targetInstanceId: string;
  sourcePinId: string;
  targetPinId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiagramSnapshot {
  schemaVersion: number;
  instances: SnapshotInstance[];
  connections: SnapshotConnection[];
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

export async function saveDiagram(diagramId: string, snapshot: Record<string, unknown>) {
  await requireAuth();
  return apiRequest<DiagramListItem>(`/api/diagrams/${diagramId}/save`, {
    method: 'POST',
    body: { snapshot },
  });
}

export async function withdrawDiagramReview(diagramId: string) {
  await requireAuth();
  return apiRequest(`/api/diagrams/${diagramId}/withdraw-review`, {
    method: 'POST',
  });
}

export async function updateDiagram(diagramId: string, data: { name?: string; description?: string }) {
  await requireAuth();
  return apiRequest<DiagramListItem>(`/api/diagrams/${diagramId}`, {
    method: 'PATCH',
    body: data,
  });
}

export async function duplicateDiagram(diagramId: string) {
  await requireAuth();
  return apiRequest<DiagramListItem>(`/api/diagrams/${diagramId}/duplicate`, {
    method: 'POST',
  });
}

export async function requestDeleteDiagram(diagramId: string) {
  await requireAuth();
  return apiRequest(`/api/diagrams/${diagramId}/request-delete`, {
    method: 'POST',
  });
}

export async function deleteDiagram(diagramId: string) {
  await requireAuth();
  return apiRequest<void>(`/api/diagrams/${diagramId}`, {
    method: 'DELETE',
  });
}

export async function fetchDiagramReadonlySnapshot(diagramId: string) {
  await requireAuth();
  return apiRequest<DiagramEditorResponse>(`/api/diagrams/${diagramId}/editor`);
}

// ===================== Instance CRUD =====================

export async function createDiagramInstance(
  diagramId: string,
  data: { componentId: string; label?: string; positionX?: number; positionY?: number; instanceData?: Record<string, unknown> },
) {
  await requireAuth();
  return apiRequest<DiagramInstance>(`/api/diagrams/${diagramId}/instances`, {
    method: 'POST',
    body: data,
  });
}

export async function updateDiagramInstance(
  diagramId: string,
  instanceId: string,
  data: { label?: string; positionX?: number; positionY?: number; instanceData?: Record<string, unknown> },
) {
  await requireAuth();
  return apiRequest<DiagramInstance>(`/api/diagrams/${diagramId}/instances/${instanceId}`, {
    method: 'PATCH',
    body: data,
  });
}

export async function deleteDiagramInstance(diagramId: string, instanceId: string) {
  await requireAuth();
  return apiRequest<void>(`/api/diagrams/${diagramId}/instances/${instanceId}`, {
    method: 'DELETE',
  });
}

// ===================== Edge CRUD =====================

export async function createDiagramEdge(
  diagramId: string,
  data: { sourceInstanceId: string; targetInstanceId: string; sourcePinId: string; targetPinId: string },
) {
  await requireAuth();
  return apiRequest<DiagramEdge>(`/api/diagrams/${diagramId}/edges`, {
    method: 'POST',
    body: data,
  });
}

export async function deleteDiagramEdge(diagramId: string, edgeId: string) {
  await requireAuth();
  return apiRequest<void>(`/api/diagrams/${diagramId}/edges/${edgeId}`, {
    method: 'DELETE',
  });
}

// ===================== Diagram editor data =====================

export interface DiagramEditorData {
  diagram: DiagramListItem;
  instances: DiagramInstance[];
  edges: DiagramEdge[];
}

export async function fetchDiagramForEditor(diagramId: string): Promise<DiagramEditorData> {
  await requireAuth();
  const response = await apiRequest<DiagramEditorResponse>(`/api/diagrams/${diagramId}/editor`);

  // Map snapshot instances to DiagramInstance format
  // Backend now returns real DB IDs when instances exist in the DiagramInstance table
  const instances: DiagramInstance[] = response.snapshot.instances.map((inst, idx) => ({
    id: inst.id ?? `snap-${idx}`,
    diagramId,
    componentId: inst.componentId ?? '',
    label: inst.label ?? '',
    positionX: Number(inst.x) || 0,
    positionY: Number(inst.y) || 0,
    instanceData: (inst as unknown as Record<string, unknown>).instanceData as Record<string, unknown> ?? {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  // Map snapshot connections to DiagramEdge format
  const edges: DiagramEdge[] = response.snapshot.connections.map((conn, idx) => ({
    id: conn.id ?? `snap-conn-${idx}`,
    diagramId,
    sourceInstanceId: conn.fromInstanceId ?? '',
    targetInstanceId: conn.toInstanceId ?? '',
    sourcePinId: conn.fromPinId ?? '',
    targetPinId: conn.toPinId ?? '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  return {
    diagram: response.diagram,
    instances,
    edges,
  };
}

// ===================== Topology (query browser) =====================

export interface TopologyResponse {
  diagram: DiagramListItem;
  instances: Array<{
    id: string;
    diagramId: string;
    componentId: string;
    label: string;
    positionX: number;
    positionY: number;
    instanceData: Record<string, unknown>;
    component: { id: string; name: string; category: string };
    districtData: { id: string; transformerCapacity: number | null; supplyRange: string | null; supplyArea: string | null; householdCount: number | null } | null;
    gisData: { id: string; latitude: number | null; longitude: number | null } | null;
  }>;
  edges: Array<{
    id: string;
    diagramId: string;
    sourceInstanceId: string;
    targetInstanceId: string;
    sourcePinId: string;
    targetPinId: string;
    lineSegmentData: { id: string; length: number | null; wireModel: string | null; wireOwnership: string | null; wireType: string | null; isMainDisplay: boolean | null } | null;
  }>;
}

export async function fetchDiagramTopology(diagramId: string): Promise<TopologyResponse> {
  await requireAuth();
  return apiRequest<TopologyResponse>(`/api/diagrams/${diagramId}/topology`);
}
