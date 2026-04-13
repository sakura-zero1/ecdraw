import { Router } from 'express';
import { authGuard, requireRole } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';

const router = Router();

// ===================== Outage Simulation =====================

// POST /outage-simulate — simulate power outage by disconnecting a switch point
router.post('/outage-simulate', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR', 'VIEWER'), async (req, res) => {
  const { diagramId, disconnectInstanceId } = req.body ?? {};

  if (!diagramId) {
    res.status(400).json({ message: 'diagramId 不能为空' });
    return;
  }
  if (!disconnectInstanceId) {
    res.status(400).json({ message: 'disconnectInstanceId 不能为空' });
    return;
  }

  // 1. Fetch topology data for the diagram
  const diagram = await prisma.diagram.findUnique({
    where: { id: String(diagramId) },
    select: { id: true, name: true, status: true, ownerId: true },
  });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }

  // Check read permission (reuse the same logic as topology endpoint)
  const user = req.user!;
  const canRead =
    user.roles.includes('ADMIN') ||
    diagram.ownerId === user.id ||
    diagram.status === 'PUBLISHED' ||
    (user.roles.includes('REVIEWER') && diagram.status === 'PENDING_REVIEW');
  if (!canRead) {
    res.status(403).json({ message: '无权限查看该图纸' });
    return;
  }

  const instances = await prisma.diagramInstance.findMany({
    where: { diagramId: String(diagramId) },
    select: {
      id: true,
      label: true,
      component: { select: { category: true } },
      districtData: {
        select: { householdCount: true, supplyArea: true },
      },
    },
  });

  const edges = await prisma.diagramEdge.findMany({
    where: { diagramId: String(diagramId) },
    select: {
      id: true,
      sourceInstanceId: true,
      targetInstanceId: true,
    },
  });

  // 2. Build instance lookup map
  const instanceMap = new Map<string, (typeof instances)[number]>();
  for (const inst of instances) {
    instanceMap.set(inst.id, inst);
  }

  // 3. Find the disconnect instance — verify it exists and is a switchPoint
  const disconnectInstance = instanceMap.get(String(disconnectInstanceId));
  if (!disconnectInstance) {
    res.status(404).json({ message: '要断开的实例不存在' });
    return;
  }
  if (disconnectInstance.component.category !== 'switchPoint') {
    res.status(400).json({ message: '只能断开分合点(switchPoint)类型的实例' });
    return;
  }

  // 4. Find all power sources (powerPoint category)
  const powerSourceIds: string[] = [];
  for (const inst of instances) {
    if (inst.component.category === 'powerPoint') {
      powerSourceIds.push(inst.id);
    }
  }
  if (powerSourceIds.length === 0) {
    res.status(400).json({ message: '图纸中没有电源点(powerPoint)，无法进行停电模拟' });
    return;
  }

  // 5. Build adjacency list, excluding edges connected to the disconnect instance
  const adjacency = new Map<string, Set<string>>();
  for (const inst of instances) {
    adjacency.set(inst.id, new Set());
  }

  for (const edge of edges) {
    // Skip edges connected to the disconnected switch point
    if (edge.sourceInstanceId === disconnectInstanceId || edge.targetInstanceId === disconnectInstanceId) {
      continue;
    }
    adjacency.get(edge.sourceInstanceId)?.add(edge.targetInstanceId);
    adjacency.get(edge.targetInstanceId)?.add(edge.sourceInstanceId);
  }

  // Remove the disconnect instance from the adjacency map entirely
  adjacency.delete(disconnectInstanceId);

  // 6. BFS from all power points simultaneously
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const sourceId of powerSourceIds) {
    if (!visited.has(sourceId)) {
      visited.add(sourceId);
      queue.push(sourceId);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  // 7. Determine reachable vs unreachable
  const reachableInstanceIds: string[] = [];
  const unreachableInstanceIds: string[] = [];

  for (const inst of instances) {
    // The disconnected instance itself is neither reachable nor unreachable — skip it
    if (inst.id === disconnectInstanceId) continue;

    if (visited.has(inst.id)) {
      reachableInstanceIds.push(inst.id);
    } else {
      unreachableInstanceIds.push(inst.id);
    }
  }

  // 8. Collect statistics for unreachable instances with DistrictData
  let affectedHouseholdCount = 0;
  const affectedDistricts: Array<{
    instanceId: string;
    label: string;
    householdCount: number | null;
    supplyArea: string | null;
  }> = [];

  for (const instId of unreachableInstanceIds) {
    const inst = instanceMap.get(instId)!;
    if (inst.districtData) {
      affectedDistricts.push({
        instanceId: inst.id,
        label: inst.label,
        householdCount: inst.districtData.householdCount,
        supplyArea: inst.districtData.supplyArea,
      });
      if (inst.districtData.householdCount != null) {
        affectedHouseholdCount += inst.districtData.householdCount;
      }
    }
  }

  res.json({
    reachableInstanceIds,
    unreachableInstanceIds,
    statistics: {
      affectedDistrictCount: affectedDistricts.length,
      affectedHouseholdCount,
      affectedDistricts,
    },
  });
});

// ===================== Power Flow =====================

// POST /power-flow — power flow calculation
router.post('/power-flow', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR', 'VIEWER'), (_req, res) => {
  res.status(501).json({ message: '潮流计算功能尚未实现' });
});

// ===================== Fault Analysis =====================

// POST /fault-analysis — fault analysis
router.post('/fault-analysis', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), (_req, res) => {
  res.status(501).json({ message: '故障分析功能尚未实现' });
});

export default router;
