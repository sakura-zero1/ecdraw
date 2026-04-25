import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authGuard, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';

const router = Router();

function canReadDiagram(user: { id: string; roles: string[] }, diagram: { ownerId: string; status: string }) {
  if (user.roles.includes('ADMIN')) return true;
  if (diagram.ownerId === user.id) return true;
  if (diagram.status === 'PUBLISHED') return true;
  if (user.roles.includes('REVIEWER') && diagram.status === 'PENDING_REVIEW') return true;
  return false;
}

function canWriteDiagram(user: { id: string; roles: string[] }, diagram: { ownerId: string }) {
  return user.roles.includes('ADMIN') || diagram.ownerId === user.id;
}

function defaultDiagramSnapshot() {
  return {
    schemaVersion: 1,
    instances: [] as unknown[],
    connections: [] as unknown[],
    selection: { instanceIds: [] as string[], connectionIds: [] as string[] },
    viewport: { zoom: 1, panX: 0, panY: 0 },
  };
}

function normalizeDiagramSnapshot(snapshot: unknown) {
  const base = defaultDiagramSnapshot();
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return base;
  }

  const value = snapshot as Record<string, unknown>;
  return {
    schemaVersion: Number(value.schemaVersion) || 1,
    instances: Array.isArray(value.instances) ? value.instances : [],
    connections: Array.isArray(value.connections) ? value.connections : [],
    selection:
      value.selection && typeof value.selection === 'object' && !Array.isArray(value.selection)
        ? {
            instanceIds: Array.isArray((value.selection as Record<string, unknown>).instanceIds)
              ? (value.selection as Record<string, unknown>).instanceIds
              : [],
            connectionIds: Array.isArray((value.selection as Record<string, unknown>).connectionIds)
              ? (value.selection as Record<string, unknown>).connectionIds
              : [],
          }
        : base.selection,
    viewport:
      value.viewport && typeof value.viewport === 'object' && !Array.isArray(value.viewport)
        ? {
            zoom: Number((value.viewport as Record<string, unknown>).zoom) || 1,
            panX: Number((value.viewport as Record<string, unknown>).panX) || 0,
            panY: Number((value.viewport as Record<string, unknown>).panY) || 0,
          }
        : base.viewport,
  };
}

async function getLatestDiagramVersion(diagramId: string) {
  return prisma.diagramVersion.findFirst({
    where: { diagramId },
    orderBy: { versionNo: 'desc' },
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function saveDiagramSnapshot(diagramId: string, snapshot: unknown, userId: string) {
  return prisma.$transaction(async (tx) => {
    const latest = await tx.diagramVersion.findFirst({
      where: { diagramId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });
    const nextVersionNo = (latest?.versionNo || 0) + 1;

    const createdVersion = await tx.diagramVersion.create({
      data: {
        diagramId,
        versionNo: nextVersionNo,
        snapshot,
        createdBy: userId,
      },
    });

    return createdVersion;
  });
}

// GET / — list diagrams
router.get('/', authGuard, async (req, res) => {
  const isAdmin = req.user!.roles.includes('ADMIN');
  const isReviewer = req.user!.roles.includes('REVIEWER');
  const userId = req.user!.id;

  let where = {};
  if (!isAdmin) {
    where = isReviewer
      ? {
          OR: [{ ownerId: userId }, { status: 'PENDING_REVIEW' }, { status: 'PUBLISHED' }],
        }
      : {
          OR: [{ ownerId: userId }, { status: 'PUBLISHED' }],
        };
  }

  const rows = await prisma.diagram.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      versions: {
        orderBy: { versionNo: 'desc' },
        take: 1,
      },
    },
  });
  res.json({ items: rows });
});

// GET /:id/topology — get topology data for a diagram (instances, edges, associated data)
router.get('/:id/topology', authGuard, async (req, res) => {
  const { id } = req.params;

  const diagram = await prisma.diagram.findUnique({
    where: { id },
    select: { id: true, name: true, description: true, status: true, ownerId: true, createdAt: true, updatedAt: true },
  });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canReadDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限查看该图纸' });
    return;
  }

  const instances = await prisma.diagramInstance.findMany({
    where: { diagramId: id },
    select: {
      id: true,
      diagramId: true,
      componentId: true,
      label: true,
      positionX: true,
      positionY: true,
      instanceData: true,
      component: { select: { id: true, name: true, category: true } },
      districtData: {
        select: { id: true, transformerCapacity: true, supplyRange: true, supplyArea: true, householdCount: true },
      },
      gisData: { select: { id: true, latitude: true, longitude: true } },
    },
  });

  const edges = await prisma.diagramEdge.findMany({
    where: { diagramId: id },
    select: {
      id: true,
      diagramId: true,
      sourceInstanceId: true,
      targetInstanceId: true,
      sourcePinId: true,
      targetPinId: true,
      lineSegmentData: {
        select: { id: true, startPole: true, endPole: true, length: true, wireModel: true, impedance: true },
      },
    },
  });

  res.json({ diagram, instances, edges });
});

// GET /:id — get single diagram
router.get('/:id', authGuard, async (req, res) => {
  const { id } = req.params;
  const diagram = await prisma.diagram.findUnique({
    where: { id },
    include: {
      versions: {
        orderBy: { versionNo: 'desc' },
        take: 1,
      },
    },
  });

  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canReadDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限查看该图纸' });
    return;
  }

  res.json(diagram);
});

// GET /:id/editor — get diagram for editor (real instances + edges)
router.get('/:id/editor', authGuard, async (req, res) => {
  const { id } = req.params;
  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canReadDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限查看该图纸' });
    return;
  }

  const latestVersion = await getLatestDiagramVersion(id);
  const snapshot = normalizeDiagramSnapshot(latestVersion?.snapshot);

  let realInstances = await prisma.diagramInstance.findMany({ where: { diagramId: id } });
  let realEdges = await prisma.diagramEdge.findMany({ where: { diagramId: id } });

  // Migrate legacy snapshot data into real DiagramInstance/DiagramEdge records
  if (realInstances.length === 0 && snapshot.instances.length > 0) {
    const instanceIdMap = new Map<string, string>();

    realInstances = await prisma.$transaction(async (tx) => {
      const created: typeof realInstances = [];
      for (const inst of snapshot.instances) {
        const row = await tx.diagramInstance.create({
          data: {
            diagramId: id,
            componentId: String(inst.componentId ?? ''),
            label: String(inst.label ?? ''),
            positionX: Number(inst.x) || 0,
            positionY: Number(inst.y) || 0,
            instanceData: (inst as Record<string, unknown>).instanceData ?? {},
          },
        });
        instanceIdMap.set(String(inst.id ?? ''), row.id);
        created.push(row);
      }

      for (const conn of snapshot.connections) {
        const newSourceId = instanceIdMap.get(String(conn.fromInstanceId ?? ''));
        const newTargetId = instanceIdMap.get(String(conn.toInstanceId ?? ''));
        if (newSourceId && newTargetId) {
          await tx.diagramEdge.create({
            data: {
              diagramId: id,
              sourceInstanceId: newSourceId,
              targetInstanceId: newTargetId,
              sourcePinId: String(conn.fromPinId ?? ''),
              targetPinId: String(conn.toPinId ?? ''),
            },
          });
        }
      }

      return created;
    });

    realEdges = await prisma.diagramEdge.findMany({ where: { diagramId: id } });
  }

  const instances = realInstances.map((inst) => ({
    id: inst.id,
    componentId: inst.componentId,
    label: inst.label,
    x: inst.positionX,
    y: inst.positionY,
    instanceData: inst.instanceData,
  }));

  const connections = realEdges.map((edge) => ({
    id: edge.id,
    fromInstanceId: edge.sourceInstanceId,
    toInstanceId: edge.targetInstanceId,
    fromPinId: edge.sourcePinId,
    toPinId: edge.targetPinId,
  }));

  res.json({
    diagram,
    versionNo: latestVersion?.versionNo || 0,
    snapshot: {
      schemaVersion: snapshot.schemaVersion,
      instances,
      connections,
      selection: snapshot.selection,
      viewport: snapshot.viewport,
    },
  });
});

// POST / — create diagram
router.post('/', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { name, description, snapshot } = req.body ?? {};
  if (!name) {
    res.status(400).json({ message: 'name 不能为空' });
    return;
  }

  const initialSnapshot =
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? snapshot
      : {
          schemaVersion: 1,
          instances: [],
          connections: [],
          viewport: { zoom: 1, panX: 0, panY: 0 },
        };

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.diagram.create({
      data: {
        name: String(name),
        description: description ? String(description) : '',
        ownerId: req.user!.id,
        status: 'DRAFT',
      },
    });

    await tx.diagramVersion.create({
      data: {
        diagramId: created.id,
        versionNo: 1,
        snapshot: initialSnapshot,
        createdBy: req.user!.id,
      },
    });

    return tx.diagram.findUnique({
      where: { id: created.id },
      include: {
        versions: {
          orderBy: { versionNo: 'desc' },
          take: 1,
        },
      },
    });
  });

  await writeAudit(req.user!.id, 'DIAGRAM_CREATE', 'Diagram', result.id, {
    name: result.name,
    status: result.status,
  });

  res.status(201).json(result);
});

// POST /:id/save — save diagram snapshot
router.post('/:id/save', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const { snapshot } = req.body ?? {};
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    res.status(400).json({ message: 'snapshot 不能为空且必须为对象' });
    return;
  }

  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限保存该图纸' });
    return;
  }
  if (diagram.status === 'PUBLISHED') {
    res.status(400).json({ message: '已发布图纸不允许保存草稿' });
    return;
  }

  const saved = await prisma.$transaction(async (tx) => {
    const latest = await tx.diagramVersion.findFirst({
      where: { diagramId: id },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });
    const nextVersionNo = (latest?.versionNo || 0) + 1;

    await tx.diagramVersion.create({
      data: {
        diagramId: id,
        versionNo: nextVersionNo,
        snapshot,
        createdBy: req.user!.id,
      },
    });

    return tx.diagram.update({
      where: { id },
      data: {
        status: 'DRAFT',
      },
    });
  });

  await writeAudit(req.user!.id, 'DIAGRAM_SAVE', 'Diagram', id, {
    versionNo: saved.versions?.[0]?.versionNo ?? null,
  });

  res.json(saved);
});

// DELETE /:id — delete diagram
router.delete('/:id', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const diagram = await prisma.diagram.findUnique({ where: { id } });

  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限删除该图纸' });
    return;
  }
  if (diagram.status !== 'DRAFT' && diagram.status !== 'REJECTED') {
    res.status(400).json({ message: '仅草稿或驳回状态图纸允许删除' });
    return;
  }

  await prisma.diagram.delete({ where: { id } });

  await writeAudit(req.user!.id, 'DIAGRAM_DELETE', 'Diagram', id, {
    name: diagram.name,
    status: diagram.status,
  });

  res.status(204).send();
});

// PATCH /:id — update diagram metadata (name, description)
router.patch('/:id', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body ?? {};

  if (name === undefined && description === undefined) {
    res.status(400).json({ message: '至少提供 name 或 description' });
    return;
  }

  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限修改该图纸' });
    return;
  }
  if (diagram.status !== 'DRAFT' && diagram.status !== 'REJECTED') {
    res.status(400).json({ message: '仅草稿或驳回状态的图纸允许修改' });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = String(name);
  if (description !== undefined) updates.description = String(description);

  const updated = await prisma.diagram.update({
    where: { id },
    data: updates,
    include: {
      versions: { orderBy: { versionNo: 'desc' }, take: 1 },
    },
  });

  await writeAudit(req.user!.id, 'DIAGRAM_UPDATE', 'Diagram', id, updates);

  res.json(updated);
});

// POST /:id/duplicate — duplicate a diagram
router.post('/:id/duplicate', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id } = req.params;

  const diagram = await prisma.diagram.findUnique({
    where: { id },
    include: {
      versions: { orderBy: { versionNo: 'desc' }, take: 1 },
      instances: true,
      edges: true,
    },
  });

  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canReadDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限查看该图纸' });
    return;
  }

  // Determine duplicate name: "原名称 副本" or "原名称 副本N"
  const baseName = diagram.name;
  const existingDuplicates = await prisma.diagram.findMany({
    where: { name: { startsWith: baseName + ' 副本' } },
    select: { name: true },
  });
  const suffixCount = existingDuplicates.length;
  const newName = suffixCount === 0
    ? `${baseName} 副本`
    : `${baseName} 副本${suffixCount + 1}`;

  const result = await prisma.$transaction(async (tx) => {
    // Create new diagram
    const newDiagram = await tx.diagram.create({
      data: {
        name: newName,
        description: diagram.description,
        ownerId: req.user!.id,
        status: 'DRAFT',
      },
    });

    // Copy latest version snapshot
    const latestVersion = diagram.versions[0];
    if (latestVersion) {
      await tx.diagramVersion.create({
        data: {
          diagramId: newDiagram.id,
          versionNo: 1,
          snapshot: latestVersion.snapshot,
          createdBy: req.user!.id,
        },
      });
    }

    // Map old instance IDs to new instance IDs
    const instanceIdMap = new Map<string, string>();

    // Copy instances
    for (const inst of diagram.instances) {
      const newInst = await tx.diagramInstance.create({
        data: {
          diagramId: newDiagram.id,
          componentId: inst.componentId,
          label: inst.label,
          positionX: inst.positionX,
          positionY: inst.positionY,
          instanceData: inst.instanceData,
        },
      });
      instanceIdMap.set(inst.id, newInst.id);
    }

    // Copy edges (only if both source and target instances were copied)
    for (const edge of diagram.edges) {
      const newSourceId = instanceIdMap.get(edge.sourceInstanceId);
      const newTargetId = instanceIdMap.get(edge.targetInstanceId);
      if (newSourceId && newTargetId) {
        await tx.diagramEdge.create({
          data: {
            diagramId: newDiagram.id,
            sourceInstanceId: newSourceId,
            targetInstanceId: newTargetId,
            sourcePinId: edge.sourcePinId,
            targetPinId: edge.targetPinId,
          },
        });
      }
    }

    return tx.diagram.findUnique({
      where: { id: newDiagram.id },
      include: {
        versions: { orderBy: { versionNo: 'desc' }, take: 1 },
      },
    });
  });

  await writeAudit(req.user!.id, 'DIAGRAM_DUPLICATE', 'Diagram', result!.id, {
    sourceDiagramId: id,
    sourceName: diagram.name,
    newName,
  });

  res.status(201).json(result);
});

// POST /:id/request-delete — request diagram deletion (requires review)
router.post('/:id/request-delete', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const diagram = await prisma.diagram.findUnique({ where: { id } });

  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限删除该图纸' });
    return;
  }
  if (diagram.status === 'PENDING_DELETE') {
    res.status(400).json({ message: '该图纸已在删除审核中' });
    return;
  }
  if (diagram.status === 'PENDING_REVIEW') {
    res.status(400).json({ message: '该图纸正在发布审核中，无法同时申请删除' });
    return;
  }

  // Need a version for ReviewRequest — ensure at least one exists
  const latestVersion = await getLatestDiagramVersion(id);
  if (!latestVersion) {
    res.status(400).json({ message: '图纸缺少版本数据' });
    return;
  }

  const previousStatus = diagram.status;

  const review = await prisma.$transaction(async (tx) => {
    await tx.diagram.update({
      where: { id },
      data: { status: 'PENDING_DELETE' },
    });

    return tx.reviewRequest.create({
      data: {
        diagramId: id,
        diagramVersionId: latestVersion.id,
        submitterId: req.user!.id,
        status: 'PENDING',
      },
    });
  });

  await writeAudit(req.user!.id, 'DIAGRAM_REQUEST_DELETE', 'Diagram', id, {
    previousStatus,
    reviewRequestId: review.id,
  });

  res.status(201).json(review);
});

// ===================== DiagramInstance CRUD =====================

// POST /:id/instances — create diagram instance
router.post('/:id/instances', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const { componentId, label, positionX, positionY, instanceData } = req.body ?? {};

  if (!componentId) {
    res.status(400).json({ message: 'componentId 不能为空' });
    return;
  }

  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限编辑该图纸' });
    return;
  }
  if (diagram.status === 'PUBLISHED') {
    res.status(400).json({ message: '已发布图纸不允许编辑' });
    return;
  }

  const component = await prisma.component.findUnique({ where: { id: String(componentId) } });
  if (!component) {
    res.status(404).json({ message: '元件不存在' });
    return;
  }

  const instance = await prisma.diagramInstance.create({
    data: {
      diagramId: id,
      componentId: String(componentId),
      label: label ? String(label) : component.name,
      positionX: Number(positionX) || 0,
      positionY: Number(positionY) || 0,
      instanceData: instanceData ?? {},
    },
  });

  await writeAudit(req.user!.id, 'DIAGRAM_INSTANCE_CREATE', 'DiagramInstance', instance.id, {
    diagramId: id,
    componentId: String(componentId),
  });

  res.status(201).json(instance);
});

// PATCH /:id/instances/:instanceId — update diagram instance
router.patch('/:id/instances/:instanceId', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id, instanceId } = req.params;
  const { label, positionX, positionY, instanceData, componentId } = req.body ?? {};

  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限编辑该图纸' });
    return;
  }
  if (diagram.status === 'PUBLISHED') {
    res.status(400).json({ message: '已发布图纸不允许编辑' });
    return;
  }

  const existing = await prisma.diagramInstance.findUnique({ where: { id: instanceId } });
  if (!existing || existing.diagramId !== id) {
    res.status(404).json({ message: '实例不存在' });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (label !== undefined) updates.label = String(label);
  if (positionX !== undefined) {
    const n = Number(positionX);
    if (Number.isNaN(n)) {
      res.status(400).json({ message: 'positionX 必须为数字' });
      return;
    }
    updates.positionX = n;
  }
  if (positionY !== undefined) {
    const n = Number(positionY);
    if (Number.isNaN(n)) {
      res.status(400).json({ message: 'positionY 必须为数字' });
      return;
    }
    updates.positionY = n;
  }
  if (instanceData !== undefined) updates.instanceData = instanceData;
  if (componentId !== undefined) updates.componentId = String(componentId);

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: '没有可更新字段' });
    return;
  }

  const updated = await prisma.diagramInstance.update({
    where: { id: instanceId },
    data: updates,
  });

  await writeAudit(req.user!.id, 'DIAGRAM_INSTANCE_UPDATE', 'DiagramInstance', instanceId, { diagramId: id });

  res.json(updated);
});

// DELETE /:id/instances/:instanceId — delete diagram instance
router.delete('/:id/instances/:instanceId', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id, instanceId } = req.params;

  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限编辑该图纸' });
    return;
  }
  if (diagram.status === 'PUBLISHED') {
    res.status(400).json({ message: '已发布图纸不允许编辑' });
    return;
  }

  const existing = await prisma.diagramInstance.findUnique({ where: { id: instanceId } });
  if (!existing || existing.diagramId !== id) {
    res.status(404).json({ message: '实例不存在' });
    return;
  }

  await prisma.diagramInstance.delete({ where: { id: instanceId } });

  await writeAudit(req.user!.id, 'DIAGRAM_INSTANCE_DELETE', 'DiagramInstance', instanceId, { diagramId: id });

  res.status(204).send();
});

// ===================== DiagramEdge CRUD =====================

// POST /:id/edges — create diagram edge
router.post('/:id/edges', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const { sourceInstanceId, targetInstanceId, sourcePinId, targetPinId } = req.body ?? {};

  if (!sourceInstanceId || !targetInstanceId || !sourcePinId || !targetPinId) {
    res.status(400).json({ message: 'sourceInstanceId/targetInstanceId/sourcePinId/targetPinId 不能为空' });
    return;
  }

  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限编辑该图纸' });
    return;
  }
  if (diagram.status === 'PUBLISHED') {
    res.status(400).json({ message: '已发布图纸不允许编辑' });
    return;
  }

  // Verify source and target instances exist in this diagram
  const sourceInstance = await prisma.diagramInstance.findUnique({ where: { id: String(sourceInstanceId) } });
  const targetInstance = await prisma.diagramInstance.findUnique({ where: { id: String(targetInstanceId) } });
  if (!sourceInstance || sourceInstance.diagramId !== id) {
    res.status(400).json({ message: 'sourceInstance 不存在或不属于该图纸' });
    return;
  }
  if (!targetInstance || targetInstance.diagramId !== id) {
    res.status(400).json({ message: 'targetInstance 不存在或不属于该图纸' });
    return;
  }

  const edge = await prisma.diagramEdge.create({
    data: {
      diagramId: id,
      sourceInstanceId: String(sourceInstanceId),
      targetInstanceId: String(targetInstanceId),
      sourcePinId: String(sourcePinId),
      targetPinId: String(targetPinId),
    },
  });

  await writeAudit(req.user!.id, 'DIAGRAM_EDGE_CREATE', 'DiagramEdge', edge.id, { diagramId: id });

  res.status(201).json(edge);
});

// DELETE /:id/edges/:edgeId — delete diagram edge
router.delete('/:id/edges/:edgeId', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id, edgeId } = req.params;

  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限编辑该图纸' });
    return;
  }
  if (diagram.status === 'PUBLISHED') {
    res.status(400).json({ message: '已发布图纸不允许编辑' });
    return;
  }

  const existing = await prisma.diagramEdge.findUnique({ where: { id: edgeId } });
  if (!existing || existing.diagramId !== id) {
    res.status(404).json({ message: '边不存在' });
    return;
  }

  await prisma.diagramEdge.delete({ where: { id: edgeId } });

  await writeAudit(req.user!.id, 'DIAGRAM_EDGE_DELETE', 'DiagramEdge', edgeId, { diagramId: id });

  res.status(204).send();
});

// ===================== Legacy snapshot-based instance/connection routes =====================
// These operate on the DiagramVersion snapshot JSON for backward compatibility

// POST /:id/submit-review — submit diagram for review
router.post('/:id/submit-review', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const diagram = await prisma.diagram.findUnique({ where: { id } });

  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限提交该图纸审核' });
    return;
  }
  if (diagram.status === 'PUBLISHED') {
    res.status(400).json({ message: '已发布图纸不可重复提交审核' });
    return;
  }
  const latestVersion = await getLatestDiagramVersion(id);
  if (!latestVersion) {
    res.status(400).json({ message: '图纸缺少可审核版本，请先保存草稿' });
    return;
  }

  const pendingExists = await prisma.reviewRequest.findFirst({
    where: {
      diagramId: id,
      status: 'PENDING',
    },
    select: { id: true },
  });
  if (pendingExists) {
    res.status(409).json({ message: '该图纸已有待审核记录' });
    return;
  }

  const review = await prisma.$transaction(async (tx) => {
    await tx.diagram.update({
      where: { id },
      data: { status: 'PENDING_REVIEW' },
    });

    return tx.reviewRequest.create({
      data: {
        diagramId: id,
        diagramVersionId: latestVersion.id,
        submitterId: req.user!.id,
        status: 'PENDING',
      },
    });
  });

  await writeAudit(req.user!.id, 'DIAGRAM_SUBMIT_REVIEW', 'Diagram', id, {
    diagramVersionId: latestVersion.id,
    reviewRequestId: review.id,
  });

  res.status(201).json(review);
});

// POST /:id/withdraw-review — withdraw diagram from review back to draft
router.post('/:id/withdraw-review', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const diagram = await prisma.diagram.findUnique({ where: { id } });

  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user!, diagram)) {
    res.status(403).json({ message: '无权限撤回该图纸审核' });
    return;
  }
  if (diagram.status !== 'PENDING_REVIEW') {
    res.status(400).json({ message: '仅审核中的图纸可以撤回' });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.diagram.update({
      where: { id },
      data: { status: 'DRAFT' },
    });

    // Close pending review request
    await tx.reviewRequest.updateMany({
      where: { diagramId: id, status: 'PENDING' },
      data: { status: 'WITHDRAWN' },
    });
  });

  await writeAudit(req.user!.id, 'DIAGRAM_WITHDRAW_REVIEW', 'Diagram', id, {});

  const updated = await prisma.diagram.findUnique({ where: { id } });
  res.json(updated);
});

export default router;
