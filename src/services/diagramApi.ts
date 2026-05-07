import { tauriRequest, ensureTauriAuth } from './tauriClient';

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

interface DiagramEditorResponse {
  diagram: DiagramListItem;
  versionNo: number;
  snapshot: DiagramSnapshot;
}

async function requireAuth() {
  const ok = await ensureTauriAuth();
  if (!ok) throw new Error('未登录，无法访问 API');
}

export async function fetchPublishedDiagrams() {
  await requireAuth();
  const response = await tauriRequest<DiagramListItem[]>('list_diagrams');
  return response.filter((item) => item.status === 'PUBLISHED');
}

export async function fetchDiagrams() {
  await requireAuth();
  return tauriRequest<DiagramListItem[]>('list_diagrams');
}

export async function createDiagramByApi(name: string, description = '') {
  await requireAuth();
  return tauriRequest<DiagramListItem>('create_diagram', { name, description });
}

export async function submitDiagramReview(diagramId: string) {
  await requireAuth();
  return tauriRequest('submit_diagram_review', { id: diagramId });
}

export async function saveDiagram(diagramId: string, snapshot: Record<string, unknown>) {
  await requireAuth();
  return tauriRequest<DiagramListItem>('save_diagram', { id: diagramId, snapshot });
}

export async function withdrawDiagramReview(diagramId: string) {
  await requireAuth();
  return tauriRequest('withdraw_diagram_review', { id: diagramId });
}

export async function updateDiagram(diagramId: string, data: { name?: string; description?: string }) {
  await requireAuth();
  return tauriRequest<DiagramListItem>('update_diagram', { id: diagramId, ...data });
}

export async function duplicateDiagram(diagramId: string) {
  await requireAuth();
  return tauriRequest<DiagramListItem>('duplicate_diagram', { id: diagramId });
}

export async function requestDeleteDiagram(diagramId: string) {
  await requireAuth();
  return tauriRequest('request_delete_diagram', { id: diagramId });
}

export async function deleteDiagram(diagramId: string) {
  await requireAuth();
  return tauriRequest<void>('delete_diagram', { id: diagramId });
}

export async function fetchDiagramReadonlySnapshot(diagramId: string) {
  await requireAuth();
  return tauriRequest<DiagramEditorResponse>('get_diagram_editor', { id: diagramId });
}

// ===================== Instance CRUD =====================

export async function createDiagramInstance(
  diagramId: string,
  data: { componentId: string; label?: string; positionX?: number; positionY?: number; instanceData?: Record<string, unknown> },
) {
  await requireAuth();
  return tauriRequest<DiagramInstance>('create_diagram_instance', {
    diagram_id: diagramId,
    component_id: data.componentId,
    label: data.label,
    position_x: data.positionX,
    position_y: data.positionY,
    instance_data: data.instanceData,
  });
}

export async function updateDiagramInstance(
  diagramId: string,
  instanceId: string,
  data: { label?: string; positionX?: number; positionY?: number; instanceData?: Record<string, unknown> },
) {
  await requireAuth();
  return tauriRequest<DiagramInstance>('update_diagram_instance', {
    diagram_id: diagramId,
    instance_id: instanceId,
    label: data.label,
    position_x: data.positionX,
    position_y: data.positionY,
    instance_data: data.instanceData,
  });
}

export async function deleteDiagramInstance(diagramId: string, instanceId: string) {
  await requireAuth();
  return tauriRequest<void>('delete_diagram_instance', { diagram_id: diagramId, instance_id: instanceId });
}

// ===================== Edge CRUD =====================

export async function createDiagramEdge(
  diagramId: string,
  data: { sourceInstanceId: string; targetInstanceId: string; sourcePinId: string; targetPinId: string },
) {
  await requireAuth();
  return tauriRequest<DiagramEdge>('create_diagram_edge', {
    diagram_id: diagramId,
    source_instance_id: data.sourceInstanceId,
    target_instance_id: data.targetInstanceId,
    source_pin_id: data.sourcePinId,
    target_pin_id: data.targetPinId,
  });
}

export async function deleteDiagramEdge(diagramId: string, edgeId: string) {
  await requireAuth();
  return tauriRequest<void>('delete_diagram_edge', { diagram_id: diagramId, edge_id: edgeId });
}

// ===================== Diagram editor data =====================

export interface DiagramEditorData {
  diagram: DiagramListItem;
  instances: DiagramInstance[];
  edges: DiagramEdge[];
}

export async function fetchDiagramForEditor(diagramId: string): Promise<DiagramEditorData> {
  await requireAuth();
  const response = await tauriRequest<DiagramEditorResponse>('get_diagram_editor', { id: diagramId });

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

  return { diagram: response.diagram, instances, edges };
}

// ===================== Topology =====================

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
  return tauriRequest<TopologyResponse>('get_diagram_topology', { id: diagramId });
}
