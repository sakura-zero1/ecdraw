import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authGuard, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';

const router = Router();

// GET /diagram/:diagramId — get all line data for a diagram
router.get('/diagram/:diagramId', authGuard, async (req, res) => {
  const { diagramId } = req.params;

  const lines = await prisma.lineSegmentData.findMany({
    where: {
      diagramEdge: { diagramId },
    },
    include: {
      diagramEdge: {
        select: {
          id: true,
          sourceInstanceId: true,
          targetInstanceId: true,
          sourcePinId: true,
          targetPinId: true,
        },
      },
    },
  });

  res.json({ items: lines });
});

// GET /:id — get single line segment data
router.get('/:id', authGuard, async (req, res) => {
  const { id } = req.params;

  const line = await prisma.lineSegmentData.findUnique({
    where: { id },
    include: {
      diagramEdge: {
        select: { id: true, diagramId: true, sourceInstanceId: true, targetInstanceId: true },
      },
    },
  });

  if (!line) {
    res.status(404).json({ message: '线段数据不存在' });
    return;
  }

  res.json(line);
});

// PUT /edge/:edgeId — upsert line data by edge ID
router.put('/edge/:edgeId', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR', 'LINE_EDITOR'), async (req, res) => {
  const { edgeId } = req.params;
  const { length, wireModel, wireOwnership, wireType, isMainDisplay } = req.body ?? {};

  // Verify edge exists
  const edge = await prisma.diagramEdge.findUnique({ where: { id: edgeId } });
  if (!edge) {
    res.status(404).json({ message: '边不存在' });
    return;
  }

  const data = {
    length: length !== undefined ? Number(length) : null,
    wireModel: wireModel !== undefined ? String(wireModel) : null,
    wireOwnership: wireOwnership !== undefined ? String(wireOwnership) : null,
    wireType: wireType !== undefined ? String(wireType) : null,
    isMainDisplay: isMainDisplay !== undefined ? Boolean(isMainDisplay) : true,
    updatedBy: req.user!.id,
  };

  const line = await prisma.lineSegmentData.upsert({
    where: { diagramEdgeId: edgeId },
    update: data,
    create: {
      diagramEdgeId: edgeId,
      ...data,
    },
  });

  await writeAudit(req.user!.id, 'LINE_DATA_UPSERT', 'LineSegmentData', line.id, {
    edgeId,
    length: data.length,
  });

  res.json(line);
});

// POST /batch — batch upsert line segment data
router.post('/batch', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR', 'LINE_EDITOR'), async (req, res, next) => {
  try {
    const { items } = req.body as { items: Array<{
      diagramEdgeId: string;
      length?: number | null;
      wireModel?: string | null;
      wireOwnership?: string | null;
      wireType?: string | null;
      isMainDisplay?: boolean | null;
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
        prisma.lineSegmentData.upsert({
          where: { diagramEdgeId: item.diagramEdgeId },
          create: {
            diagramEdgeId: item.diagramEdgeId,
            length: item.length ?? null,
            wireModel: item.wireModel ?? null,
            wireOwnership: item.wireOwnership ?? null,
            wireType: item.wireType ?? null,
            isMainDisplay: item.isMainDisplay ?? true,
            updatedBy: req.user!.id,
          },
          update: {
            ...(item.length !== undefined ? { length: item.length } : {}),
            ...(item.wireModel !== undefined ? { wireModel: item.wireModel } : {}),
            ...(item.wireOwnership !== undefined ? { wireOwnership: item.wireOwnership } : {}),
            ...(item.wireType !== undefined ? { wireType: item.wireType } : {}),
            ...(item.isMainDisplay !== undefined ? { isMainDisplay: item.isMainDisplay } : {}),
            updatedBy: req.user!.id,
          },
        })
      )
    );
    res.json({ count: results.length });
  } catch (err) { next(err); }
});

export default router;
