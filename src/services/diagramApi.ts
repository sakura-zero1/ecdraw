import { request, ensureAuth } from './unifiedClient';

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

export type LineType = 'straight' | 'curve' | 'polyline' | 'polyline-hvh' | 'polyline-vhv';

export interface DiagramEdge {
  id: string;
  diagramId: string;
  sourceInstanceId: string;
  targetInstanceId: string;
  sourcePinId: string;
  targetPinId: string;
  lineType: LineType;
  polylineMidRatio?: number;
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
  const ok = await ensureAuth();
  if (!ok) throw new Error('未登录，无法访问 API');
}

export async function fetchPublishedDiagrams() {
  await requireAuth();
  const response = await request<DiagramListItem[]>('list_diagrams');
  return response.filter((item) => item.status === 'PUBLISHED');
}

export async function fetchDiagrams() {
  await requireAuth();
  return request<DiagramListItem[]>('list_diagrams');
}

export async function createDiagramByApi(name: string, description = '') {
  await requireAuth();
  return request<DiagramListItem>('create_diagram', { name, description });
}

export async function submitDiagramReview(diagramId: string) {
  await requireAuth();
  return request('submit_diagram_review', { id: diagramId });
}

export async function saveDiagram(diagramId: string, snapshot: Record<string, unknown>) {
  await requireAuth();
  return request<DiagramListItem>('save_diagram', { id: diagramId, snapshot });
}

export async function withdrawDiagramReview(diagramId: string) {
  await requireAuth();
  return request('withdraw_diagram_review', { id: diagramId });
}

export async function reviseDiagram(diagramId: string) {
  await requireAuth();
  return request<DiagramListItem>('revise_diagram', { id: diagramId });
}

export async function discardRevision(diagramId: string) {
  await requireAuth();
  return request<DiagramListItem>('discard_revision', { id: diagramId });
}

export async function updateDiagram(diagramId: string, data: { name?: string; description?: string }) {
  await requireAuth();
  return request<DiagramListItem>('update_diagram', { id: diagramId, ...data });
}

export async function duplicateDiagram(diagramId: string) {
  await requireAuth();
  return request<DiagramListItem>('duplicate_diagram', { id: diagramId });
}

export async function requestDeleteDiagram(diagramId: string) {
  await requireAuth();
  return request('request_delete_diagram', { id: diagramId });
}

export async function deleteDiagram(diagramId: string) {
  await requireAuth();
  return request<void>('delete_diagram', { id: diagramId });
}

export async function fetchDiagramReadonlySnapshot(diagramId: string) {
  await requireAuth();
  // Rust API returns { diagram, instances, edges, latestVersion }
  const raw = await request<{
    diagram: DiagramListItem;
    instances: DiagramInstance[];
    edges: DiagramEdge[];
    latestVersion: { id: string; versionNo: number; snapshot: DiagramSnapshot } | null;
  }>('get_diagram_editor', { id: diagramId });

  // Convert to the DiagramEditorResponse format expected by district/line/gis pages
  const latestSnapshot = raw.latestVersion?.snapshot ?? {} as DiagramSnapshot;
  const result: DiagramEditorResponse = {
    diagram: raw.diagram,
    versionNo: raw.latestVersion?.versionNo ?? 0,
    snapshot: {
      schemaVersion: latestSnapshot.schemaVersion ?? 1,
      instances: (raw.instances ?? []).map((inst) => ({
        id: inst.id,
        componentId: inst.componentId,
        label: inst.label ?? '',
        x: inst.positionX ?? 0,
        y: inst.positionY ?? 0,
        instanceData: inst.instanceData as Record<string, unknown> ?? {},
        rotation: 0,
      })),
      connections: (raw.edges ?? []).map((edge) => ({
        id: edge.id,
        fromInstanceId: edge.sourceInstanceId,
        fromPinId: edge.sourcePinId ?? '',
        toInstanceId: edge.targetInstanceId,
        toPinId: edge.targetPinId ?? '',
        lineType: (edge as any).lineType ?? 'straight',
        state: 'closed' as const,
        visible: true,
        label: '',
      })),
      selection: { instanceIds: [], connectionIds: [] },
      viewport: { zoom: 1, panX: 0, panY: 0 },
    },
  };
  return result;
}

// ===================== Instance CRUD =====================

export async function createDiagramInstance(
  diagramId: string,
  data: { componentId: string; label?: string; positionX?: number; positionY?: number; instanceData?: Record<string, unknown> },
) {
  await requireAuth();
  return request<DiagramInstance>('create_diagram_instance', {
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
  return request<DiagramInstance>('update_diagram_instance', {
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
  return request<void>('delete_diagram_instance', { diagram_id: diagramId, instance_id: instanceId });
}

// ===================== Edge CRUD =====================

export async function createDiagramEdge(
  diagramId: string,
  data: { sourceInstanceId: string; targetInstanceId: string; sourcePinId: string; targetPinId: string; lineType?: LineType; polylineMidRatio?: number },
) {
  await requireAuth();
  return request<DiagramEdge>('create_diagram_edge', {
    diagram_id: diagramId,
    source_instance_id: data.sourceInstanceId,
    target_instance_id: data.targetInstanceId,
    source_pin_id: data.sourcePinId,
    target_pin_id: data.targetPinId,
    line_type: data.lineType,
    polyline_mid_ratio: data.polylineMidRatio,
  });
}

export async function updateDiagramEdgeLineType(diagramId: string, edgeId: string, lineType: LineType) {
  await requireAuth();
  return request<DiagramEdge>('update_diagram_edge_line_type', {
    diagram_id: diagramId,
    edge_id: edgeId,
    line_type: lineType,
  });
}

export async function updateDiagramEdgePolylineMidRatio(diagramId: string, edgeId: string, polylineMidRatio: number) {
  await requireAuth();
  return request<DiagramEdge>('update_diagram_edge_polyline_mid_ratio', {
    diagram_id: diagramId,
    edge_id: edgeId,
    polyline_mid_ratio: polylineMidRatio,
  });
}

export async function deleteDiagramEdge(diagramId: string, edgeId: string) {
  await requireAuth();
  return request<void>('delete_diagram_edge', { diagram_id: diagramId, edge_id: edgeId });
}

// ===================== Diagram editor data =====================

export interface DiagramEditorData {
  diagram: DiagramListItem;
  instances: DiagramInstance[];
  edges: DiagramEdge[];
  latestVersionStatus: VersionStatus | null;
}

export async function fetchDiagramForEditor(diagramId: string): Promise<DiagramEditorData> {
  await requireAuth();
  // Rust API returns { diagram, instances, edges, latestVersion } at top level
  const response = await request<{
    diagram: DiagramListItem;
    instances: DiagramInstance[];
    edges: DiagramEdge[];
    latestVersion: { id: string; versionNo: number; status: VersionStatus; snapshot: DiagramSnapshot } | null;
  }>('get_diagram_editor', { id: diagramId });

  const instances: DiagramInstance[] = (response.instances ?? []).map((inst) => ({
    id: inst.id,
    diagramId,
    componentId: inst.componentId,
    label: inst.label ?? '',
    positionX: inst.positionX ?? 0,
    positionY: inst.positionY ?? 0,
    instanceData: inst.instanceData ?? {},
    createdAt: inst.createdAt ?? new Date().toISOString(),
    updatedAt: inst.updatedAt ?? new Date().toISOString(),
  }));

  const edges: DiagramEdge[] = (response.edges ?? []).map((edge) => ({
    id: edge.id,
    diagramId,
    sourceInstanceId: edge.sourceInstanceId,
    targetInstanceId: edge.targetInstanceId,
    sourcePinId: edge.sourcePinId ?? '',
    targetPinId: edge.targetPinId ?? '',
    lineType: edge.lineType ?? 'straight',
    polylineMidRatio: edge.polylineMidRatio ?? undefined,
    createdAt: edge.createdAt ?? new Date().toISOString(),
    updatedAt: edge.updatedAt ?? new Date().toISOString(),
  }));

  return {
    diagram: response.diagram,
    instances,
    edges,
    latestVersionStatus: response.latestVersion?.status ?? null,
  };
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
    component: { id: string; name: string; category: string; snapshot?: unknown };
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
    lineType?: LineType;
    polylineMidRatio?: number | null;
    lineSegmentData: { id: string; length: number | null; wireModel: string | null; wireOwnership: string | null; wireType: string | null; isMainDisplay: boolean | null } | null;
  }>;
}

export async function fetchDiagramTopology(diagramId: string): Promise<TopologyResponse> {
  await requireAuth();
  return request<TopologyResponse>('get_diagram_topology', { id: diagramId });
}

// ========== Version Timeline ==========

export type VersionStatus = 'DRAFT' | 'REVIEWING' | 'ONLINE' | 'REJECTED' | 'DECOMMISSIONED';

export interface VersionSummary {
  id: string;
  versionNo: number;
  status: VersionStatus;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
}

export async function fetchDiagramVersions(diagramId: string): Promise<VersionSummary[]> {
  await requireAuth();
  return request<VersionSummary[]>('list_diagram_versions', { id: diagramId });
}

export async function fetchDiagramVersionTopology(
  diagramId: string,
  versionId: string,
): Promise<TopologyResponse> {
  await requireAuth();
  return request<TopologyResponse>('get_diagram_version_topology', {
    id: diagramId,
    versionId,
  });
}

export async function deleteDiagramVersion(diagramId: string, versionId: string) {
  await requireAuth();
  return request<void>('delete_diagram_version', { id: diagramId, versionId });
}
