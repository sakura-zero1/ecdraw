import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authGuard, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /dashboard — system overview statistics
router.get('/dashboard', authGuard, requireRole('ADMIN'), async (_req, res) => {
  const [
    userCount,
    componentCount,
    diagramCount,
    publishedCount,
    pendingReviewCount,
    instanceCount,
    edgeCount,
    districtDataCount,
    lineDataCount,
    gisDataCount,
    recentAudits,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.component.count(),
    prisma.diagram.count(),
    prisma.diagram.count({ where: { status: 'PUBLISHED' } }),
    prisma.reviewRequest.count({ where: { status: 'PENDING' } }),
    prisma.diagramInstance.count(),
    prisma.diagramEdge.count(),
    prisma.districtData.count(),
    prisma.lineSegmentData.count(),
    prisma.gisData.count(),
    prisma.auditLog.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        action: true,
        targetType: true,
        targetId: true,
        createdAt: true,
        user: { select: { username: true } },
      },
    }),
  ]);

  const diagramsByStatus = await prisma.diagram.groupBy({
    by: ['status'],
    _count: { status: true },
  });

  res.json({
    userCount,
    componentCount,
    diagramCount,
    publishedCount,
    pendingReviewCount,
    instanceCount,
    edgeCount,
    districtDataCount,
    lineDataCount,
    gisDataCount,
    diagramsByStatus: diagramsByStatus.map((d) => ({
      status: d.status,
      count: d._count.status,
    })),
    recentAudits,
  });
});

export default router;
