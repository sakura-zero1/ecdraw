import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();

const PORT = Number(process.env.API_PORT || 3001);
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev_access_secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret';

const USER_ROLES = ['ADMIN', 'COMPONENT_EDITOR', 'DIAGRAM_EDITOR', 'REVIEWER', 'VIEWER'];
const USER_STATUSES = ['ACTIVE', 'DISABLED'];
const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^http:\/\/localhost(?::\d+)?$/i.test(origin)) return true;
  if (/^http:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin)) return true;
  return false;
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: false,
  })
);
app.use(express.json({ limit: '2mb' }));

function issueTokens(user) {
  const payload = {
    sub: user.id,
    id: user.id,
    username: user.username,
    role: user.role,
  };
  const accessToken = jwt.sign(payload, ACCESS_SECRET, { expiresIn: '1h' });
  const refreshToken = jwt.sign(payload, REFRESH_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

function authGuard(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ message: '缺少鉴权令牌' });
    return;
  }
  const token = auth.slice(7).trim();
  try {
    const payload = jwt.verify(token, ACCESS_SECRET);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: '令牌无效或已过期' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: '无权限访问' });
      return;
    }
    next();
  };
}

async function writeAudit(userId, action, targetType, targetId, payload = null) {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      targetType,
      targetId,
      payload,
    },
  });
}

function canReadComponent(user, component) {
  return user.role === 'ADMIN' || component.ownerId === user.id || component.isPublic;
}

function canWriteComponent(user, component) {
  return user.role === 'ADMIN' || component.ownerId === user.id;
}

function canReadDiagram(user, diagram) {
  if (user.role === 'ADMIN') return true;
  if (diagram.ownerId === user.id) return true;
  if (diagram.status === 'PUBLISHED') return true;
  if (user.role === 'REVIEWER' && diagram.status === 'PENDING_REVIEW') return true;
  return false;
}

function canWriteDiagram(user, diagram) {
  return user.role === 'ADMIN' || diagram.ownerId === user.id;
}

function defaultDiagramSnapshot() {
  return {
    schemaVersion: 1,
    instances: [],
    connections: [],
    selection: { instanceIds: [], connectionIds: [] },
    viewport: { zoom: 1, panX: 0, panY: 0 },
  };
}

function normalizeDiagramSnapshot(snapshot) {
  const base = defaultDiagramSnapshot();
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return base;
  }

  const value = snapshot;
  return {
    schemaVersion: Number(value.schemaVersion) || 1,
    instances: Array.isArray(value.instances) ? value.instances : [],
    connections: Array.isArray(value.connections) ? value.connections : [],
    selection:
      value.selection && typeof value.selection === 'object' && !Array.isArray(value.selection)
        ? {
            instanceIds: Array.isArray(value.selection.instanceIds) ? value.selection.instanceIds : [],
            connectionIds: Array.isArray(value.selection.connectionIds) ? value.selection.connectionIds : [],
          }
        : base.selection,
    viewport:
      value.viewport && typeof value.viewport === 'object' && !Array.isArray(value.viewport)
        ? {
            zoom: Number(value.viewport.zoom) || 1,
            panX: Number(value.viewport.panX) || 0,
            panY: Number(value.viewport.panY) || 0,
          }
        : base.viewport,
  };
}

async function getLatestDiagramVersion(diagramId) {
  return prisma.diagramVersion.findFirst({
    where: { diagramId },
    orderBy: { versionNo: 'desc' },
  });
}

async function saveDiagramSnapshot(diagramId, snapshot, userId) {
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

    await tx.diagram.update({
      where: { id: diagramId },
      data: {
        currentVersionId: createdVersion.id,
        status: 'DRAFT',
      },
    });

    return createdVersion;
  });
}

app.get('/api/health', async (_, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'up' });
  } catch (err) {
    res.status(500).json({ ok: false, db: 'down', error: String(err) });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ message: 'username/password 不能为空' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { username: String(username) } });
  if (!user || user.status !== 'ACTIVE') {
    res.status(401).json({ message: '用户名或密码错误' });
    return;
  }

  const ok = await bcrypt.compare(String(password), user.passwordHash);
  if (!ok) {
    res.status(401).json({ message: '用户名或密码错误' });
    return;
  }

  const tokens = issueTokens(user);
  res.json({
    ...tokens,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) {
    res.status(400).json({ message: 'refreshToken 不能为空' });
    return;
  }

  try {
    const payload = jwt.verify(String(refreshToken), REFRESH_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user || user.status !== 'ACTIVE') {
      res.status(401).json({ message: '用户不可用' });
      return;
    }

    const tokens = issueTokens(user);
    res.json({
      ...tokens,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch {
    res.status(401).json({ message: 'refreshToken 无效或已过期' });
  }
});

app.get('/api/users', authGuard, requireRole('ADMIN'), async (_, res) => {
  const rows = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      username: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  res.json({ items: rows });
});

app.post('/api/users', authGuard, requireRole('ADMIN'), async (req, res) => {
  const { username, password, role, status } = req.body ?? {};
  if (!username || !password || !role) {
    res.status(400).json({ message: 'username/password/role 不能为空' });
    return;
  }
  if (!USER_ROLES.includes(role)) {
    res.status(400).json({ message: 'role 不合法' });
    return;
  }
  if (status && !USER_STATUSES.includes(status)) {
    res.status(400).json({ message: 'status 不合法' });
    return;
  }

  const exists = await prisma.user.findUnique({ where: { username: String(username) } });
  if (exists) {
    res.status(409).json({ message: '用户名已存在' });
    return;
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const user = await prisma.user.create({
    data: {
      username: String(username),
      passwordHash,
      role,
      status: status || 'ACTIVE',
    },
    select: {
      id: true,
      username: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await writeAudit(req.user.id, 'USER_CREATE', 'User', user.id, {
    username: user.username,
    role: user.role,
    status: user.status,
  });

  res.status(201).json(user);
});

app.patch('/api/users/:id', authGuard, requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const { role, status, password } = req.body ?? {};

  const updates = {};
  if (role !== undefined) {
    if (!USER_ROLES.includes(role)) {
      res.status(400).json({ message: 'role 不合法' });
      return;
    }
    updates.role = role;
  }
  if (status !== undefined) {
    if (!USER_STATUSES.includes(status)) {
      res.status(400).json({ message: 'status 不合法' });
      return;
    }
    updates.status = status;
  }
  if (password !== undefined) {
    if (!String(password)) {
      res.status(400).json({ message: 'password 不能为空' });
      return;
    }
    updates.passwordHash = await bcrypt.hash(String(password), 10);
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: '没有可更新字段' });
    return;
  }

  const user = await prisma.user.update({
    where: { id },
    data: updates,
    select: {
      id: true,
      username: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await writeAudit(req.user.id, 'USER_UPDATE', 'User', user.id, {
    role: updates.role,
    status: updates.status,
    passwordReset: updates.passwordHash ? true : false,
  });

  res.json(user);
});

app.get('/api/components', authGuard, async (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;
  const where =
    role === 'ADMIN'
      ? {}
      : {
          OR: [{ ownerId: userId }, { isPublic: true }],
        };

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

app.get('/api/components/:id', authGuard, async (req, res) => {
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
  if (!canReadComponent(req.user, row)) {
    res.status(403).json({ message: '无权限查看该元件' });
    return;
  }

  res.json(row);
});

app.post('/api/components', authGuard, requireRole('ADMIN', 'COMPONENT_EDITOR'), async (req, res) => {
  const { name, category, description, isPublic } = req.body ?? {};
  if (!name || !category) {
    res.status(400).json({ message: 'name/category 不能为空' });
    return;
  }

  const created = await prisma.component.create({
    data: {
      name: String(name),
      category: String(category),
      description: description ? String(description) : '',
      isPublic: Boolean(isPublic),
      ownerId: req.user.id,
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
      createdBy: req.user.id,
    },
  });

  await writeAudit(req.user.id, 'COMPONENT_CREATE', 'Component', created.id, {
    name: created.name,
    category: created.category,
  });

  res.status(201).json(created);
});

app.patch('/api/components/:id', authGuard, requireRole('ADMIN', 'COMPONENT_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const { name, category, description, isPublic } = req.body ?? {};

  const existing = await prisma.component.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ message: '元件不存在' });
    return;
  }
  if (!canWriteComponent(req.user, existing)) {
    res.status(403).json({ message: '无权限修改该元件' });
    return;
  }

  const updates = {};
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
  if (isPublic !== undefined) {
    if (typeof isPublic !== 'boolean') {
      res.status(400).json({ message: 'isPublic 必须为 boolean' });
      return;
    }
    updates.isPublic = isPublic;
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: '没有可更新字段' });
    return;
  }

  const updated = await prisma.component.update({
    where: { id },
    data: updates,
  });

  await writeAudit(req.user.id, 'COMPONENT_UPDATE', 'Component', updated.id, {
    name: updates.name,
    category: updates.category,
    isPublic: updates.isPublic,
  });

  res.json(updated);
});

app.post('/api/components/:id/duplicate', authGuard, requireRole('ADMIN', 'COMPONENT_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const source = await prisma.component.findUnique({ where: { id } });

  if (!source) {
    res.status(404).json({ message: '元件不存在' });
    return;
  }

  if (req.user.role !== 'ADMIN' && source.ownerId !== req.user.id && !source.isPublic) {
    res.status(403).json({ message: '无权限复制该元件' });
    return;
  }

  const latestVersion = await prisma.componentVersion.findFirst({
    where: { componentId: source.id },
    orderBy: { versionNo: 'desc' },
  });

  const prefix = `${source.name}副本`;
  let next = 2;
  while (true) {
    const probe = await prisma.component.findFirst({ where: { name: `${prefix}${next}` } });
    if (!probe) break;
    next += 1;
  }
  const newName = `${prefix}${next}`;

  const created = await prisma.component.create({
    data: {
      name: newName,
      category: source.category,
      description: source.description,
      isPublic: false,
      ownerId: req.user.id,
    },
  });

  await prisma.componentVersion.create({
    data: {
      componentId: created.id,
      versionNo: 1,
      snapshot:
        latestVersion?.snapshot || {
          schemaVersion: 1,
          shapeElements: [],
          pins: [],
          matrix: { connections: [] },
        },
      createdBy: req.user.id,
    },
  });

  await writeAudit(req.user.id, 'COMPONENT_DUPLICATE', 'Component', created.id, {
    sourceId: source.id,
    sourceName: source.name,
    newName,
  });

  res.status(201).json(created);
});

app.delete('/api/components/:id', authGuard, requireRole('ADMIN', 'COMPONENT_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.component.findUnique({ where: { id } });

  if (!existing) {
    res.status(404).json({ message: '元件不存在' });
    return;
  }
  if (!canWriteComponent(req.user, existing)) {
    res.status(403).json({ message: '无权限删除该元件' });
    return;
  }

  await prisma.component.delete({ where: { id } });

  await writeAudit(req.user.id, 'COMPONENT_DELETE', 'Component', id, {
    name: existing.name,
    category: existing.category,
  });

  res.status(204).send();
});

app.get('/api/components/:id/versions', authGuard, async (req, res) => {
  const { id } = req.params;
  const component = await prisma.component.findUnique({ where: { id } });

  if (!component) {
    res.status(404).json({ message: '元件不存在' });
    return;
  }
  if (!canReadComponent(req.user, component)) {
    res.status(403).json({ message: '无权限查看该元件版本' });
    return;
  }

  const versions = await prisma.componentVersion.findMany({
    where: { componentId: id },
    orderBy: { versionNo: 'desc' },
  });

  res.json({ items: versions });
});

app.get('/api/components/:id/versions/:versionNo', authGuard, async (req, res) => {
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
  if (!canReadComponent(req.user, component)) {
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

app.post('/api/components/:id/versions', authGuard, requireRole('ADMIN', 'COMPONENT_EDITOR'), async (req, res) => {
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
  if (!canWriteComponent(req.user, component)) {
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
        createdBy: req.user.id,
      },
    });
  });

  await writeAudit(req.user.id, 'COMPONENT_VERSION_CREATE', 'ComponentVersion', created.id, {
    componentId: id,
    versionNo: created.versionNo,
  });

  res.status(201).json(created);
});

app.get('/api/diagrams', authGuard, async (req, res) => {
  const role = req.user.role;
  const userId = req.user.id;

  let where = {};
  if (role !== 'ADMIN') {
    where =
      role === 'REVIEWER'
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

app.get('/api/diagrams/:id', authGuard, async (req, res) => {
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
  if (!canReadDiagram(req.user, diagram)) {
    res.status(403).json({ message: '无权限查看该图纸' });
    return;
  }

  res.json(diagram);
});

app.get('/api/diagrams/:id/editor', authGuard, async (req, res) => {
  const { id } = req.params;
  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canReadDiagram(req.user, diagram)) {
    res.status(403).json({ message: '无权限查看该图纸' });
    return;
  }

  const latestVersion = await getLatestDiagramVersion(id);
  const snapshot = normalizeDiagramSnapshot(latestVersion?.snapshot);
  res.json({
    diagram,
    versionNo: latestVersion?.versionNo || 0,
    snapshot,
  });
});

app.post('/api/diagrams', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
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
        ownerId: req.user.id,
        status: 'DRAFT',
      },
    });

    const version = await tx.diagramVersion.create({
      data: {
        diagramId: created.id,
        versionNo: 1,
        snapshot: initialSnapshot,
        createdBy: req.user.id,
      },
    });

    return tx.diagram.update({
      where: { id: created.id },
      data: { currentVersionId: version.id },
      include: {
        versions: {
          orderBy: { versionNo: 'desc' },
          take: 1,
        },
      },
    });
  });

  await writeAudit(req.user.id, 'DIAGRAM_CREATE', 'Diagram', result.id, {
    name: result.name,
    status: result.status,
  });

  res.status(201).json(result);
});

app.post('/api/diagrams/:id/save', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
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
  if (!canWriteDiagram(req.user, diagram)) {
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

    const version = await tx.diagramVersion.create({
      data: {
        diagramId: id,
        versionNo: nextVersionNo,
        snapshot,
        createdBy: req.user.id,
      },
    });

    return tx.diagram.update({
      where: { id },
      data: {
        currentVersionId: version.id,
        status: 'DRAFT',
      },
      include: {
        versions: {
          orderBy: { versionNo: 'desc' },
          take: 1,
        },
      },
    });
  });

  await writeAudit(req.user.id, 'DIAGRAM_SAVE', 'Diagram', id, {
    versionNo: saved.versions?.[0]?.versionNo ?? null,
  });

  res.json(saved);
});

app.post('/api/diagrams/:id/instances', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const { componentId, componentVersionId, x, y, rotation, scale, label } = req.body ?? {};

  if (!componentId) {
    res.status(400).json({ message: 'componentId 不能为空' });
    return;
  }

  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user, diagram)) {
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
  if (!canReadComponent(req.user, component)) {
    res.status(403).json({ message: '无权限引用该元件' });
    return;
  }

  const snapshotVersion = componentVersionId
    ? await prisma.componentVersion.findUnique({ where: { id: String(componentVersionId) } })
    : await prisma.componentVersion.findFirst({
        where: { componentId: String(componentId) },
        orderBy: { versionNo: 'desc' },
      });

  if (!snapshotVersion || snapshotVersion.componentId !== component.id) {
    res.status(404).json({ message: '元件版本不存在' });
    return;
  }

  const latest = await getLatestDiagramVersion(id);
  const snapshot = normalizeDiagramSnapshot(latest?.snapshot);

  const instance = {
    id: crypto.randomUUID(),
    componentId: component.id,
    componentVersionId: snapshotVersion.id,
    label: label ? String(label) : component.name,
    x: Number(x) || 0,
    y: Number(y) || 0,
    rotation: Number(rotation) || 0,
    scale: Number(scale) > 0 ? Number(scale) : 1,
  };
  snapshot.instances.push(instance);
  snapshot.selection = { instanceIds: [instance.id], connectionIds: [] };

  const createdVersion = await saveDiagramSnapshot(id, snapshot, req.user.id);
  await writeAudit(req.user.id, 'DIAGRAM_INSTANCE_ADD', 'Diagram', id, {
    instanceId: instance.id,
    componentId: component.id,
    versionNo: createdVersion.versionNo,
  });

  res.status(201).json({ instance, versionNo: createdVersion.versionNo });
});

app.patch('/api/diagrams/:id/instances/:instanceId', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id, instanceId } = req.params;
  const { x, y, rotation, scale, label } = req.body ?? {};

  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user, diagram)) {
    res.status(403).json({ message: '无权限编辑该图纸' });
    return;
  }
  if (diagram.status === 'PUBLISHED') {
    res.status(400).json({ message: '已发布图纸不允许编辑' });
    return;
  }

  const latest = await getLatestDiagramVersion(id);
  const snapshot = normalizeDiagramSnapshot(latest?.snapshot);
  const target = snapshot.instances.find((item) => item.id === instanceId);
  if (!target) {
    res.status(404).json({ message: '实例不存在' });
    return;
  }

  if (x !== undefined) target.x = Number(x) || 0;
  if (y !== undefined) target.y = Number(y) || 0;
  if (rotation !== undefined) target.rotation = Number(rotation) || 0;
  if (scale !== undefined) target.scale = Number(scale) > 0 ? Number(scale) : 1;
  if (label !== undefined) target.label = String(label);

  const createdVersion = await saveDiagramSnapshot(id, snapshot, req.user.id);
  await writeAudit(req.user.id, 'DIAGRAM_INSTANCE_UPDATE', 'Diagram', id, {
    instanceId,
    versionNo: createdVersion.versionNo,
  });

  res.json({ instance: target, versionNo: createdVersion.versionNo });
});

app.delete('/api/diagrams/:id/instances/:instanceId', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id, instanceId } = req.params;

  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user, diagram)) {
    res.status(403).json({ message: '无权限编辑该图纸' });
    return;
  }
  if (diagram.status === 'PUBLISHED') {
    res.status(400).json({ message: '已发布图纸不允许编辑' });
    return;
  }

  const latest = await getLatestDiagramVersion(id);
  const snapshot = normalizeDiagramSnapshot(latest?.snapshot);
  const exists = snapshot.instances.some((item) => item.id === instanceId);
  if (!exists) {
    res.status(404).json({ message: '实例不存在' });
    return;
  }

  snapshot.instances = snapshot.instances.filter((item) => item.id !== instanceId);
  snapshot.connections = snapshot.connections.filter(
    (line) => line.fromInstanceId !== instanceId && line.toInstanceId !== instanceId
  );
  snapshot.selection.instanceIds = snapshot.selection.instanceIds.filter((value) => value !== instanceId);
  snapshot.selection.connectionIds = snapshot.selection.connectionIds.filter((connectionId) =>
    snapshot.connections.some((line) => line.id === connectionId)
  );

  const createdVersion = await saveDiagramSnapshot(id, snapshot, req.user.id);
  await writeAudit(req.user.id, 'DIAGRAM_INSTANCE_DELETE', 'Diagram', id, {
    instanceId,
    versionNo: createdVersion.versionNo,
  });

  res.status(204).send();
});

app.post('/api/diagrams/:id/connections', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const { fromInstanceId, fromPinId, toInstanceId, toPinId, state, visible, label } = req.body ?? {};
  if (!fromInstanceId || !fromPinId || !toInstanceId || !toPinId) {
    res.status(400).json({ message: 'from/to 实例与引脚不能为空' });
    return;
  }

  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user, diagram)) {
    res.status(403).json({ message: '无权限编辑该图纸' });
    return;
  }
  if (diagram.status === 'PUBLISHED') {
    res.status(400).json({ message: '已发布图纸不允许编辑' });
    return;
  }

  const latest = await getLatestDiagramVersion(id);
  const snapshot = normalizeDiagramSnapshot(latest?.snapshot);
  const fromExists = snapshot.instances.some((item) => item.id === fromInstanceId);
  const toExists = snapshot.instances.some((item) => item.id === toInstanceId);
  if (!fromExists || !toExists) {
    res.status(400).json({ message: '连接的实例不存在' });
    return;
  }

  const connection = {
    id: crypto.randomUUID(),
    fromInstanceId: String(fromInstanceId),
    fromPinId: String(fromPinId),
    toInstanceId: String(toInstanceId),
    toPinId: String(toPinId),
    state: state === 'open' ? 'open' : 'closed',
    visible: visible === undefined ? true : Boolean(visible),
    label: label ? String(label) : '',
  };
  snapshot.connections.push(connection);
  snapshot.selection = { instanceIds: [], connectionIds: [connection.id] };

  const createdVersion = await saveDiagramSnapshot(id, snapshot, req.user.id);
  await writeAudit(req.user.id, 'DIAGRAM_CONNECTION_ADD', 'Diagram', id, {
    connectionId: connection.id,
    versionNo: createdVersion.versionNo,
  });

  res.status(201).json({ connection, versionNo: createdVersion.versionNo });
});

app.patch('/api/diagrams/:id/connections/:connectionId', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id, connectionId } = req.params;
  const { state, visible, label } = req.body ?? {};

  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user, diagram)) {
    res.status(403).json({ message: '无权限编辑该图纸' });
    return;
  }
  if (diagram.status === 'PUBLISHED') {
    res.status(400).json({ message: '已发布图纸不允许编辑' });
    return;
  }

  const latest = await getLatestDiagramVersion(id);
  const snapshot = normalizeDiagramSnapshot(latest?.snapshot);
  const target = snapshot.connections.find((item) => item.id === connectionId);
  if (!target) {
    res.status(404).json({ message: '连线不存在' });
    return;
  }

  if (state !== undefined) {
    if (state !== 'open' && state !== 'closed') {
      res.status(400).json({ message: 'state 仅支持 open/closed' });
      return;
    }
    target.state = state;
  }
  if (visible !== undefined) target.visible = Boolean(visible);
  if (label !== undefined) target.label = String(label);

  const createdVersion = await saveDiagramSnapshot(id, snapshot, req.user.id);
  await writeAudit(req.user.id, 'DIAGRAM_CONNECTION_UPDATE', 'Diagram', id, {
    connectionId,
    versionNo: createdVersion.versionNo,
  });

  res.json({ connection: target, versionNo: createdVersion.versionNo });
});

app.delete('/api/diagrams/:id/connections/:connectionId', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id, connectionId } = req.params;

  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user, diagram)) {
    res.status(403).json({ message: '无权限编辑该图纸' });
    return;
  }
  if (diagram.status === 'PUBLISHED') {
    res.status(400).json({ message: '已发布图纸不允许编辑' });
    return;
  }

  const latest = await getLatestDiagramVersion(id);
  const snapshot = normalizeDiagramSnapshot(latest?.snapshot);
  const exists = snapshot.connections.some((item) => item.id === connectionId);
  if (!exists) {
    res.status(404).json({ message: '连线不存在' });
    return;
  }

  snapshot.connections = snapshot.connections.filter((item) => item.id !== connectionId);
  snapshot.selection.connectionIds = snapshot.selection.connectionIds.filter((value) => value !== connectionId);

  const createdVersion = await saveDiagramSnapshot(id, snapshot, req.user.id);
  await writeAudit(req.user.id, 'DIAGRAM_CONNECTION_DELETE', 'Diagram', id, {
    connectionId,
    versionNo: createdVersion.versionNo,
  });

  res.status(204).send();
});

app.patch('/api/diagrams/:id/selection', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const { instanceIds, connectionIds } = req.body ?? {};

  const diagram = await prisma.diagram.findUnique({ where: { id } });
  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user, diagram)) {
    res.status(403).json({ message: '无权限编辑该图纸' });
    return;
  }
  if (diagram.status === 'PUBLISHED') {
    res.status(400).json({ message: '已发布图纸不允许编辑' });
    return;
  }

  const latest = await getLatestDiagramVersion(id);
  const snapshot = normalizeDiagramSnapshot(latest?.snapshot);

  const validInstanceIds = new Set(snapshot.instances.map((item) => item.id));
  const validConnectionIds = new Set(snapshot.connections.map((item) => item.id));
  snapshot.selection = {
    instanceIds: Array.isArray(instanceIds) ? instanceIds.filter((value) => validInstanceIds.has(value)) : [],
    connectionIds: Array.isArray(connectionIds) ? connectionIds.filter((value) => validConnectionIds.has(value)) : [],
  };

  const createdVersion = await saveDiagramSnapshot(id, snapshot, req.user.id);
  await writeAudit(req.user.id, 'DIAGRAM_SELECTION_UPDATE', 'Diagram', id, {
    versionNo: createdVersion.versionNo,
    instanceCount: snapshot.selection.instanceIds.length,
    connectionCount: snapshot.selection.connectionIds.length,
  });

  res.json({ selection: snapshot.selection, versionNo: createdVersion.versionNo });
});

app.post('/api/diagrams/:id/submit-review', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const diagram = await prisma.diagram.findUnique({ where: { id } });

  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user, diagram)) {
    res.status(403).json({ message: '无权限提交该图纸审核' });
    return;
  }
  if (diagram.status === 'PUBLISHED') {
    res.status(400).json({ message: '已发布图纸不可重复提交审核' });
    return;
  }
  if (!diagram.currentVersionId) {
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
        diagramVersionId: diagram.currentVersionId,
        submitterId: req.user.id,
        status: 'PENDING',
      },
    });
  });

  await writeAudit(req.user.id, 'DIAGRAM_SUBMIT_REVIEW', 'Diagram', id, {
    diagramVersionId: diagram.currentVersionId,
    reviewRequestId: review.id,
  });

  res.status(201).json(review);
});

app.get('/api/reviews', authGuard, requireRole('ADMIN', 'REVIEWER'), async (req, res) => {
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
  const where =
    req.user.role === 'ADMIN'
      ? baseWhere
      : {
          AND: [
            baseWhere,
            {
              OR: [{ status: 'PENDING' }, { reviewerId: req.user.id }],
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
            currentVersionId: true,
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

app.post('/api/reviews/:id/approve', authGuard, requireRole('ADMIN', 'REVIEWER'), async (req, res) => {
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
  if (req.user.role === 'REVIEWER' && review.submitterId === req.user.id) {
    res.status(403).json({ message: '不允许自审' });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedReview = await tx.reviewRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewerId: req.user.id,
        reviewedAt: new Date(),
        comment: comment === undefined ? null : String(comment),
      },
    });

    const updatedDiagram = await tx.diagram.update({
      where: { id: review.diagramId },
      data: {
        status: 'PUBLISHED',
        currentVersionId: review.diagramVersionId,
      },
      select: {
        id: true,
        name: true,
        status: true,
        currentVersionId: true,
      },
    });

    return { updatedReview, updatedDiagram };
  });

  await writeAudit(req.user.id, 'REVIEW_APPROVE', 'ReviewRequest', id, {
    diagramId: review.diagramId,
    diagramVersionId: review.diagramVersionId,
    comment: comment === undefined ? null : String(comment),
  });

  res.json(result);
});

app.post('/api/reviews/:id/reject', authGuard, requireRole('ADMIN', 'REVIEWER'), async (req, res) => {
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
  if (req.user.role === 'REVIEWER' && review.submitterId === req.user.id) {
    res.status(403).json({ message: '不允许自审' });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedReview = await tx.reviewRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewerId: req.user.id,
        reviewedAt: new Date(),
        comment: comment === undefined ? null : String(comment),
      },
    });

    const updatedDiagram = await tx.diagram.update({
      where: { id: review.diagramId },
      data: {
        status: 'REJECTED',
      },
      select: {
        id: true,
        name: true,
        status: true,
        currentVersionId: true,
      },
    });

    return { updatedReview, updatedDiagram };
  });

  await writeAudit(req.user.id, 'REVIEW_REJECT', 'ReviewRequest', id, {
    diagramId: review.diagramId,
    diagramVersionId: review.diagramVersionId,
    comment: comment === undefined ? null : String(comment),
  });

  res.json(result);
});

app.get('/api/audits', authGuard, requireRole('ADMIN', 'REVIEWER'), async (req, res) => {
  const { action: actionText, targetType: targetTypeText, targetId: targetIdText, page: pageText, pageSize: pageSizeText } =
    req.query ?? {};

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
            role: true,
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

app.delete('/api/diagrams/:id', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), async (req, res) => {
  const { id } = req.params;
  const diagram = await prisma.diagram.findUnique({ where: { id } });

  if (!diagram) {
    res.status(404).json({ message: '图纸不存在' });
    return;
  }
  if (!canWriteDiagram(req.user, diagram)) {
    res.status(403).json({ message: '无权限删除该图纸' });
    return;
  }
  if (diagram.status !== 'DRAFT' && diagram.status !== 'REJECTED') {
    res.status(400).json({ message: '仅草稿或驳回状态图纸允许删除' });
    return;
  }

  await prisma.diagram.delete({ where: { id } });

  await writeAudit(req.user.id, 'DIAGRAM_DELETE', 'Diagram', id, {
    name: diagram.name,
    status: diagram.status,
  });

  res.status(204).send();
});

app.use((err, _, res, __) => {
  console.error(err);
  res.status(500).json({ message: '服务器内部错误', detail: String(err?.message || err) });
});

app.listen(PORT, () => {
  console.log(`[api] running on http://localhost:${PORT}`);
});
