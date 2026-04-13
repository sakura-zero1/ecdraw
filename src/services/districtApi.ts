import { apiRequest, ensureApiAuth } from './apiClient';

export interface DistrictData {
  id: string;
  diagramInstanceId: string;
  transformerCapacity: number | null;
  supplyRange: string | null;
  supplyArea: string | null;
  householdCount: number | null;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

async function requireAuth(): Promise<void> {
  const ok = await ensureApiAuth();
  if (!ok) throw new Error('未登录');
}

export async function fetchDistrictsByDiagram(diagramId: string): Promise<DistrictData[]> {
  await requireAuth();
  const res = await apiRequest<{ items: DistrictData[] }>(`/api/districts/diagram/${diagramId}`);
  return res.items;
}

export async function upsertDistrict(instanceId: string, data: Partial<Omit<DistrictData, 'id' | 'diagramInstanceId' | 'updatedBy' | 'createdAt' | 'updatedAt'>>): Promise<DistrictData> {
  await requireAuth();
  return apiRequest<DistrictData>(`/api/districts/instance/${instanceId}`, { method: 'PUT', body: data });
}
