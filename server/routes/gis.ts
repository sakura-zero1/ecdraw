import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authGuard, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';

const router = Router();

// GET /diagram/:diagramId — get all GIS data for a diagram
router.get('/diagram/:diagramId', authGuard, async (req, res) => {
  const { diagramId } = req.params;

  const gisData = await prisma.gisData.findMany({
    where: {
      diagramInstance: { diagramId },
    },
    include: {
      diagramInstance: {
        select: { id: true, label: true, componentId: true },
      },
    },
  });

  res.json({ items: gisData });
});

// GET /:id — get single GIS data
router.get('/:id', authGuard, async (req, res) => {
  const { id } = req.params;

  const gis = await prisma.gisData.findUnique({
    where: { id },
    include: {
      diagramInstance: {
        select: { id: true, label: true, componentId: true, diagramId: true },
      },
    },
  });

  if (!gis) {
    res.status(404).json({ message: 'GIS 数据不存在' });
    return;
  }

  res.json(gis);
});

// PUT /instance/:instanceId — upsert GIS data by instance ID
router.put('/instance/:instanceId', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR', 'GIS_EDITOR'), async (req, res) => {
  const { instanceId } = req.params;
  const { latitude, longitude } = req.body ?? {};

  // Verify instance exists
  const instance = await prisma.diagramInstance.findUnique({ where: { id: instanceId } });
  if (!instance) {
    res.status(404).json({ message: '实例不存在' });
    return;
  }

  const data = {
    latitude: latitude !== undefined ? Number(latitude) : null,
    longitude: longitude !== undefined ? Number(longitude) : null,
    updatedBy: req.user!.id,
  };

  const gis = await prisma.gisData.upsert({
    where: { diagramInstanceId: instanceId },
    update: data,
    create: {
      diagramInstanceId: instanceId,
      ...data,
    },
  });

  await writeAudit(req.user!.id, 'GIS_DATA_UPSERT', 'GisData', gis.id, {
    instanceId,
    latitude: data.latitude,
    longitude: data.longitude,
  });

  res.json(gis);
});

// POST /batch — batch upsert GIS data
router.post('/batch', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR', 'GIS_EDITOR'), async (req, res, next) => {
  try {
    const { items } = req.body as { items: Array<{
      diagramInstanceId: string;
      latitude?: number | null;
      longitude?: number | null;
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
        prisma.gisData.upsert({
          where: { diagramInstanceId: item.diagramInstanceId },
          create: {
            diagramInstanceId: item.diagramInstanceId,
            latitude: item.latitude ?? null,
            longitude: item.longitude ?? null,
            updatedBy: req.user!.id,
          },
          update: {
            ...(item.latitude !== undefined ? { latitude: item.latitude } : {}),
            ...(item.longitude !== undefined ? { longitude: item.longitude } : {}),
            updatedBy: req.user!.id,
          },
        })
      )
    );
    res.json({ count: results.length });
  } catch (err) { next(err); }
});

export default router;
