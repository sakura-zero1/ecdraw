import { apiRequest, ensureApiAuth } from './apiClient';

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
  const ok = await ensureApiAuth();
  if (!ok) throw new Error('未登录');
}

export async function fetchGisByDiagram(diagramId: string): Promise<GisData[]> {
  await requireAuth();
  const res = await apiRequest<{ items: GisData[] }>(`/api/gis/diagram/${diagramId}`);
  return res.items;
}

export async function upsertGis(instanceId: string, data: { latitude?: number; longitude?: number }): Promise<GisData> {
  await requireAuth();
  return apiRequest<GisData>(`/api/gis/instance/${instanceId}`, { method: 'PUT', body: data });
}

export async function batchUpsertGis(items: Array<{
  diagramInstanceId: string;
  latitude?: number | null;
  longitude?: number | null;
}>): Promise<{ count: number }> {
  await requireAuth();
  return apiRequest<{ count: number }>('/api/gis/batch', { method: 'POST', body: { items } });
}
