import { Router } from 'express';
import { prisma } from '../utils/prisma.js';
import { authGuard, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';

const router = Router();

const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

// GET / — list reviews
router.get('/', authGuard, requireRole('ADMIN', 'REVIEWER'), async (req, res) => {
  const { status: statusText, page: pageText, pageSize: pageSizeText } = req.query ?? {};
  const status = statusText ? String(statusText) : undefined;
  if (status && !REVIEW_STATUSES.includes(status)) {
    res.status(400).json({ message: 'status 仅支持 PENDING/APPROVED/REJECTED' });
    return;
  }

  const page = Number(pageText) || 1;
  const pageSize = Math.min(Math.max(Number(pageSizeText) || 20, 1), 100);
  if (page < 1) {
    res.status(400).json({ message: 'page 必须 >= 1' });
    return;
  }

  const baseWhere = status ? { status } : {};
  const isAdmin = req.user!.roles.includes('ADMIN');
  const where = isAdmin
    ? baseWhere
    : {
        AND: [
          baseWhere,
          {
            OR: [{ status: 'PENDING' }, { reviewerId: req.user!.id }],
          },
        ],
      };

  const [total, items] = await prisma.$transaction([
    prisma.reviewRequest.count({ where }),
    prisma.reviewRequest.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { submittedAt: 'desc' },
      include: {
        diagram: {
          select: {
            id: true,
            name: true,
            status: true,
            ownerId: true,
          },
        },
        diagramVersion: {
          select: {
            id: true,
            versionNo: true,
            createdAt: true,
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

// POST /:id/approve — approve review
router.post('/:id/approve', authGuard, requireRole('ADMIN', 'REVIEWER'), async (req, res) => {
  const { id } = req.params;
  const { comment } = req.body ?? {};

  const review = await prisma.reviewRequest.findUnique({
    where: { id },
    include: {
      diagram: {
        select: { id: true, status: true, ownerId: true },
      },
    },
  });
  if (!review) {
    res.status(404).json({ message: '审核记录不存在' });
    return;
  }
  if (review.status !== 'PENDING') {
    res.status(409).json({ message: '该审核记录已处理' });
    return;
  }

  const isDeleteRequest = review.diagram.status === 'PENDING_DELETE';

  const result = await prisma.$transaction(async (tx) => {
    const updatedReview = await tx.reviewRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewerId: req.user!.id,
        reviewedAt: new Date(),
        comment: comment === undefined ? null : String(comment),
      },
    });

    if (isDeleteRequest) {
      // Approve delete: actually delete the diagram
      await tx.diagram.delete({ where: { id: review.diagramId } });
      return { updatedReview, updatedDiagram: null, deleted: true };
    } else {
      // Approve publish
      const updatedDiagram = await tx.diagram.update({
        where: { id: review.diagramId },
        data: {
          status: 'PUBLISHED',
        },
        select: {
          id: true,
          name: true,
          status: true,
        },
      });
      return { updatedReview, updatedDiagram, deleted: false };
    }
  });

  await writeAudit(req.user!.id, isDeleteRequest ? 'REVIEW_APPROVE_DELETE' : 'REVIEW_APPROVE', 'ReviewRequest', id, {
    diagramId: review.diagramId,
    diagramVersionId: review.diagramVersionId,
    comment: comment === undefined ? null : String(comment),
  });

  res.json(result);
});

// POST /:id/reject — reject review
router.post('/:id/reject', authGuard, requireRole('ADMIN', 'REVIEWER'), async (req, res) => {
  const { id } = req.params;
  const { comment } = req.body ?? {};

  const review = await prisma.reviewRequest.findUnique({
    where: { id },
    include: {
      diagram: {
        select: { id: true, status: true, ownerId: true },
      },
    },
  });
  if (!review) {
    res.status(404).json({ message: '审核记录不存在' });
    return;
  }
  if (review.status !== 'PENDING') {
    res.status(409).json({ message: '该审核记录已处理' });
    return;
  }

  const isDeleteRequest = review.diagram.status === 'PENDING_DELETE';

  const result = await prisma.$transaction(async (tx) => {
    const updatedReview = await tx.reviewRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewerId: req.user!.id,
        reviewedAt: new Date(),
        comment: comment === undefined ? null : String(comment),
      },
    });

    const newStatus = isDeleteRequest ? 'DRAFT' : 'REJECTED';
    const updatedDiagram = await tx.diagram.update({
      where: { id: review.diagramId },
      data: { status: newStatus },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });

    return { updatedReview, updatedDiagram };
  });

  await writeAudit(req.user!.id, 'REVIEW_REJECT', 'ReviewRequest', id, {
    diagramId: review.diagramId,
    diagramVersionId: review.diagramVersionId,
    comment: comment === undefined ? null : String(comment),
  });

  res.json(result);
});

export default router;
