import { tauriRequest, ensureTauriAuth } from './tauriClient';

async function requireAuth() {
  const ok = await ensureTauriAuth();
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
  return tauriRequest<OutageSimulationResult>('outage_simulate', {
    diagram_id: diagramId,
    disconnect_instance_id: disconnectInstanceId,
  });
}
