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

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
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

app.post(
  '/api/components',
  authGuard,
  requireRole('ADMIN', 'COMPONENT_EDITOR'),
  async (req, res) => {
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

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'COMPONENT_CREATE',
        targetType: 'Component',
        targetId: created.id,
        payload: { name: created.name, category: created.category },
      },
    });

    res.status(201).json(created);
  }
);

app.use((err, _, res, __) => {
  console.error(err);
  res.status(500).json({ message: '服务器内部错误', detail: String(err?.message || err) });
});

app.listen(PORT, () => {
  console.log(`[api] running on http://localhost:${PORT}`);
});

