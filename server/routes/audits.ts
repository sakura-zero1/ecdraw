import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authGuard, requireRole } from '../middleware/auth.js';

const router = Router();

// GET / — list audit logs (ADMIN, REVIEWER)
router.get('/', authGuard, requireRole('ADMIN', 'REVIEWER'), async (req, res) => {
  const {
    action: actionText,
    targetType: targetTypeText,
    targetId: targetIdText,
    page: pageText,
    pageSize: pageSizeText,
  } = req.query ?? {};

  const action = actionText ? String(actionText) : undefined;
  const targetType = targetTypeText ? String(targetTypeText) : undefined;
  const targetId = targetIdText ? String(targetIdText) : undefined;
  const page = Number(pageText) || 1;
  const pageSize = Math.min(Math.max(Number(pageSizeText) || 20, 1), 100);
  if (page < 1) {
    res.status(400).json({ message: 'page 必须 >= 1' });
    return;
  }

  const where = {
    ...(action ? { action } : {}),
    ...(targetType ? { targetType } : {}),
    ...(targetId ? { targetId } : {}),
  };

  const [total, items] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            roles: true,
          },
        },
      },
    }),
  ]);

  res.json({
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

export default router;
