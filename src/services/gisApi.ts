import { apiRequest, ensureApiAuth } from './apiClient';

export interface GisData {
  id: string;
  diagramInstanceId: string;
  latitude: number | null;
  longitude: number | null;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
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
