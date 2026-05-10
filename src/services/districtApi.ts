import { request, ensureAuth } from './unifiedClient';

export interface DistrictDataInstance {
  id: string;
  label: string;
  componentId: string;
}

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
  diagramInstance?: DistrictDataInstance;
}

async function requireAuth(): Promise<void> {
  const ok = await ensureAuth();
  if (!ok) throw new Error('未登录');
}

export async function fetchDistrictsByDiagram(diagramId: string): Promise<DistrictData[]> {
  await requireAuth();
  return request<DistrictData[]>('list_districts_by_diagram', { diagram_id: diagramId });
}

export async function upsertDistrict(instanceId: string, data: Partial<Omit<DistrictData, 'id' | 'diagramInstanceId' | 'updatedBy' | 'createdAt' | 'updatedAt'>>): Promise<DistrictData> {
  await requireAuth();
  return request<DistrictData>('upsert_district', {
    instance_id: instanceId,
    transformer_capacity: data.transformerCapacity,
    supply_range: data.supplyRange,
    supply_area: data.supplyArea,
    household_count: data.householdCount,
  });
}

export async function batchUpsertDistricts(items: Array<{
  diagramInstanceId: string;
  transformerCapacity?: number | null;
  supplyRange?: string | null;
  supplyArea?: string | null;
  householdCount?: number | null;
}>): Promise<{ count: number }> {
  await requireAuth();
  const itemsForRust = items.map(item => ({
    diagram_instance_id: item.diagramInstanceId,
    transformer_capacity: item.transformerCapacity,
    supply_range: item.supplyRange,
    supply_area: item.supplyArea,
    household_count: item.householdCount,
  }));
  return request<{ count: number }>('batch_upsert_districts', { items: itemsForRust });
}
