import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { prisma } from '../utils/prisma.js';
import { authGuard, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';

const router = Router();

function canReadComponent(user: { id: string; roles: string[] }, component: { ownerId: string }) {
  return user.roles.includes('ADMIN') || component.ownerId === user.id;
}

function canWriteComponent(user: { id: string; roles: string[] }, component: { ownerId: string }) {
  return user.roles.includes('ADMIN') || component.ownerId === user.id;
}

// GET / — list components
router.get('/', authGuard, async (req, res) => {
  const userId = req.user!.id;
  const isAdmin = req.user!.roles.includes('ADMIN');
  const where = isAdmin ? {} : { ownerId: userId };

  const rows = await prisma.component.findMany({
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

// GET /:id — get single component
router.get('/:id', authGuard, async (req, res) => {
  const { id } = req.params;
  const row = await prisma.component.findUnique({
    where: { id },
    include: {
      versions: {
        orderBy: { versionNo: 'desc' },
        take: 1,
      },
    },
  });

  if (!row) {
    res.status(404).json({ message: '元件不存在' });
    return;
  }
  if (!canReadComponent(req.user!, row)) {
    res.status(403).json({ message: '无权限查看该元件' });
    return;
  }

  res.json(row);
});

// POST / — create component
router.post('/', authGuard, requireRole('ADMIN', 'COMPONENT_EDITOR'), async (req, res) => {
  const { name, category, description } = req.body ?? {};
  if (!name || !category) {
    res.status(400).json({ message: 'name/category 不能为空' });
    return;
  }

  const created = await prisma.component.create({
    data: {
      name: String(name),
      category: String(category),
      description: description ? String(description) : '',
      ownerId: req.user!.id,
    },
  });

  await prisma.componentVersion.create({
    data: {
      componentId: created.id,
      versionNo: 1,
      snapshot: {
        schemaVersion: 1,
        shapeElements: [],
        pins: [],
        matrix: { connections: [] },
      },
      createdBy: req.user!.id,
    },
  });

  await writeAudit(req.user!.id, 'COMPONENT_CREATE', 'Component', created.id, {
    name: created.name,
    category: created.category,
  });

  res.status(201).json(created);
});

// PATCH /:id — update component
router.patch('/:id', authGuard, requireRole('ADMIN', 'COMPONENT_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const { name, category, description } = req.body ?? {};

  const existing = await prisma.component.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ message: '元件不存在' });
    return;
  }
  if (!canWriteComponent(req.user!, existing)) {
    res.status(403).json({ message: '无权限修改该元件' });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) {
    const normalizedName = String(name).trim();
    if (!normalizedName) {
      res.status(400).json({ message: 'name 不能为空' });
      return;
    }
    updates.name = normalizedName;
  }
  if (category !== undefined) {
    const normalizedCategory = String(category).trim();
    if (!normalizedCategory) {
      res.status(400).json({ message: 'category 不能为空' });
      return;
    }
    updates.category = normalizedCategory;
  }
  if (description !== undefined) {
    updates.description = String(description);
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: '没有可更新字段' });
    return;
  }

  const updated = await prisma.component.update({
    where: { id },
    data: updates,
  });

  await writeAudit(req.user!.id, 'COMPONENT_UPDATE', 'Component', updated.id, {
    name: updates.name,
    category: updates.category,
  });

  res.json(updated);
});

// POST /:id/duplicate — duplicate component
router.post('/:id/duplicate', authGuard, requireRole('ADMIN', 'COMPONENT_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const source = await prisma.component.findUnique({ where: { id } });

  if (!source) {
    res.status(404).json({ message: '元件不存在' });
    return;
  }

  if (!req.user!.roles.includes('ADMIN') && source.ownerId !== req.user!.id) {
    res.status(403).json({ message: '无权限复制该元件' });
    return;
  }

  const latestVersion = await prisma.componentVersion.findFirst({
    where: { componentId: source.id },
    orderBy: { versionNo: 'desc' },
  });

  const prefix = `${source.name}副本`;
  let newName = '';
  let next = 2;
  while (next <= 100) {
    const probe = await prisma.component.findFirst({ where: { name: `${prefix}${next}` } });
    if (!probe) {
      newName = `${prefix}${next}`;
      break;
    }
    next += 1;
  }
  if (!newName) {
    newName = `${prefix}${uuid().slice(0, 8)}`;
  }

  const created = await prisma.$transaction(async (tx) => {
    const comp = await tx.component.create({
      data: {
        name: newName,
        category: source.category,
        description: source.description,
        ownerId: req.user!.id,
      },
    });

    await tx.componentVersion.create({
      data: {
        componentId: comp.id,
        versionNo: 1,
        snapshot:
          latestVersion?.snapshot || {
            schemaVersion: 1,
            shapeElements: [],
            pins: [],
            matrix: { connections: [] },
          },
        createdBy: req.user!.id,
      },
    });

    return comp;
  });

  await writeAudit(req.user!.id, 'COMPONENT_DUPLICATE', 'Component', created.id, {
    sourceId: source.id,
    sourceName: source.name,
    newName,
  });

  res.status(201).json(created);
});

// DELETE /:id — delete component
router.delete('/:id', authGuard, requireRole('ADMIN', 'COMPONENT_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.component.findUnique({ where: { id } });

  if (!existing) {
    res.status(404).json({ message: '元件不存在' });
    return;
  }
  if (!canWriteComponent(req.user!, existing)) {
    res.status(403).json({ message: '无权限删除该元件' });
    return;
  }

  await prisma.component.delete({ where: { id } });

  await writeAudit(req.user!.id, 'COMPONENT_DELETE', 'Component', id, {
    name: existing.name,
    category: existing.category,
  });

  res.status(204).send();
});

// GET /:id/versions — list component versions
router.get('/:id/versions', authGuard, async (req, res) => {
  const { id } = req.params;
  const component = await prisma.component.findUnique({ where: { id } });

  if (!component) {
    res.status(404).json({ message: '元件不存在' });
    return;
  }
  if (!canReadComponent(req.user!, component)) {
    res.status(403).json({ message: '无权限查看该元件版本' });
    return;
  }

  const versions = await prisma.componentVersion.findMany({
    where: { componentId: id },
    orderBy: { versionNo: 'desc' },
  });

  res.json({ items: versions });
});

// GET /:id/versions/:versionNo — get specific component version
router.get('/:id/versions/:versionNo', authGuard, async (req, res) => {
  const { id, versionNo: versionNoText } = req.params;
  const versionNo = Number(versionNoText);
  if (!Number.isInteger(versionNo) || versionNo <= 0) {
    res.status(400).json({ message: 'versionNo 不合法' });
    return;
  }

  const component = await prisma.component.findUnique({ where: { id } });
  if (!component) {
    res.status(404).json({ message: '元件不存在' });
    return;
  }
  if (!canReadComponent(req.user!, component)) {
    res.status(403).json({ message: '无权限查看该元件版本' });
    return;
  }

  const version = await prisma.componentVersion.findUnique({
    where: {
      componentId_versionNo: {
        componentId: id,
        versionNo,
      },
    },
  });
  if (!version) {
    res.status(404).json({ message: '版本不存在' });
    return;
  }

  res.json(version);
});

// POST /:id/versions — create component version
router.post('/:id/versions', authGuard, requireRole('ADMIN', 'COMPONENT_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const { snapshot } = req.body ?? {};

  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    res.status(400).json({ message: 'snapshot 不能为空且必须为对象' });
    return;
  }

  const component = await prisma.component.findUnique({ where: { id } });
  if (!component) {
    res.status(404).json({ message: '元件不存在' });
    return;
  }
  if (!canWriteComponent(req.user!, component)) {
    res.status(403).json({ message: '无权限创建该元件版本' });
    return;
  }

  const created = await prisma.$transaction(async (tx) => {
    const latest = await tx.componentVersion.findFirst({
      where: { componentId: id },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });
    const nextVersionNo = (latest?.versionNo || 0) + 1;

    return tx.componentVersion.create({
      data: {
        componentId: id,
        versionNo: nextVersionNo,
        snapshot,
        createdBy: req.user!.id,
      },
    });
  });

  await writeAudit(req.user!.id, 'COMPONENT_VERSION_CREATE', 'ComponentVersion', created.id, {
    componentId: id,
    versionNo: created.versionNo,
  });

  res.status(201).json(created);
});

export default router;
