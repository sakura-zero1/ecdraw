import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authGuard, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';

const router = Router();

// GET /diagram/:diagramId — get all district data for a diagram
router.get('/diagram/:diagramId', authGuard, async (req, res) => {
  const { diagramId } = req.params;

  const districts = await prisma.districtData.findMany({
    where: {
      diagramInstance: { diagramId },
    },
    include: {
      diagramInstance: {
        select: { id: true, label: true, componentId: true },
      },
    },
  });

  res.json({ items: districts });
});

// GET /:id — get single district data
router.get('/:id', authGuard, async (req, res) => {
  const { id } = req.params;

  const district = await prisma.districtData.findUnique({
    where: { id },
    include: {
      diagramInstance: {
        select: { id: true, label: true, componentId: true, diagramId: true },
      },
    },
  });

  if (!district) {
    res.status(404).json({ message: '区域数据不存在' });
    return;
  }

  res.json(district);
});

// PUT /instance/:instanceId — upsert district data by instance ID
router.put('/instance/:instanceId', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR', 'DISTRICT_EDITOR'), async (req, res) => {
  const { instanceId } = req.params;
  const { transformerCapacity, supplyRange, supplyArea, householdCount } = req.body ?? {};

  // Verify instance exists
  const instance = await prisma.diagramInstance.findUnique({ where: { id: instanceId } });
  if (!instance) {
    res.status(404).json({ message: '实例不存在' });
    return;
  }

  const data = {
    transformerCapacity: transformerCapacity !== undefined ? Number(transformerCapacity) : null,
    supplyRange: supplyRange !== undefined ? String(supplyRange) : null,
    supplyArea: supplyArea !== undefined ? String(supplyArea) : null,
    householdCount: householdCount !== undefined ? Number(householdCount) : null,
    updatedBy: req.user!.id,
  };

  const district = await prisma.districtData.upsert({
    where: { diagramInstanceId: instanceId },
    update: data,
    create: {
      diagramInstanceId: instanceId,
      ...data,
    },
  });

  await writeAudit(req.user!.id, 'DISTRICT_DATA_UPSERT', 'DistrictData', district.id, {
    instanceId,
    transformerCapacity: data.transformerCapacity,
  });

  res.json(district);
});

// POST /batch — batch upsert district data
router.post('/batch', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR', 'DISTRICT_EDITOR'), async (req, res, next) => {
  try {
    const { items } = req.body as { items: Array<{
      diagramInstanceId: string;
      transformerCapacity?: number | null;
      supplyRange?: string | null;
      supplyArea?: string | null;
      householdCount?: number | null;
    }> };
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ message: 'items 不能为空数组' });
      return;
    }
    if (items.length > 500) {
      res.status(400).json({ message: '单次批量操作不能超过 500 条' });
      return;
    }

    const results = await Promise.all(
      items.map((item) =>
        prisma.districtData.upsert({
          where: { diagramInstanceId: item.diagramInstanceId },
          create: {
            diagramInstanceId: item.diagramInstanceId,
            transformerCapacity: item.transformerCapacity ?? null,
            supplyRange: item.supplyRange ?? null,
            supplyArea: item.supplyArea ?? null,
            householdCount: item.householdCount ?? null,
            updatedBy: req.user!.id,
          },
          update: {
            ...(item.transformerCapacity !== undefined ? { transformerCapacity: item.transformerCapacity } : {}),
            ...(item.supplyRange !== undefined ? { supplyRange: item.supplyRange } : {}),
            ...(item.supplyArea !== undefined ? { supplyArea: item.supplyArea } : {}),
            ...(item.householdCount !== undefined ? { householdCount: item.householdCount } : {}),
            updatedBy: req.user!.id,
          },
        })
      )
    );
    res.json({ count: results.length });
  } catch (err) { next(err); }
});

export default router;
