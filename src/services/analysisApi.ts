import { apiRequest, ensureApiAuth } from './apiClient';

async function requireAuth() {
  const ok = await ensureApiAuth();
  if (!ok) throw new Error('未登录');
}

export interface OutageSimulationResult {
  reachableInstanceIds: string[];
  unreachableInstanceIds: string[];
  statistics: {
    affectedDistrictCount: number;
    affectedHouseholdCount: number;
    affectedDistricts: Array<{
      instanceId: string;
      label: string;
      householdCount: number | null;
      supplyArea: string | null;
    }>;
  };
}

export async function runOutageSimulation(diagramId: string, disconnectInstanceId: string): Promise<OutageSimulationResult> {
  await requireAuth();
  return apiRequest<OutageSimulationResult>('/api/analysis/outage-simulate', {
    method: 'POST',
    body: { diagramId, disconnectInstanceId },
  });
}
