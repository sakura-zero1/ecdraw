import { tauriRequest, ensureTauriAuth } from './tauriClient';

export interface GisDataInstance {
  id: string;
  label: string;
  componentId: string;
}

export interface GisData {
  id: string;
  diagramInstanceId: string;
  latitude: number | null;
  longitude: number | null;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  diagramInstance?: GisDataInstance;
}

async function requireAuth(): Promise<void> {
  const ok = await ensureTauriAuth();
  if (!ok) throw new Error('未登录');
}

export async function fetchGisByDiagram(diagramId: string): Promise<GisData[]> {
  await requireAuth();
  return tauriRequest<GisData[]>('list_gis_by_diagram', { diagram_id: diagramId });
}

export async function upsertGis(instanceId: string, data: { latitude?: number; longitude?: number }): Promise<GisData> {
  await requireAuth();
  return tauriRequest<GisData>('upsert_gis', {
    instance_id: instanceId,
    latitude: data.latitude,
    longitude: data.longitude,
  });
}

export async function batchUpsertGis(items: Array<{
  diagramInstanceId: string;
  latitude?: number | null;
  longitude?: number | null;
}>): Promise<{ count: number }> {
  await requireAuth();
  const itemsForRust = items.map(item => ({
    diagram_instance_id: item.diagramInstanceId,
    latitude: item.latitude,
    longitude: item.longitude,
  }));
  return tauriRequest<{ count: number }>('batch_upsert_gis', { items: itemsForRust });
}
