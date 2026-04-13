import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma.js';
import { authGuard, requireRole, parseRoles } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';

const router = Router();

const VALID_ROLES = ['ADMIN', 'COMPONENT_EDITOR', 'DIAGRAM_EDITOR', 'REVIEWER', 'VIEWER', 'DISTRICT_EDITOR', 'LINE_EDITOR', 'GIS_EDITOR'];
const VALID_STATUSES = ['ACTIVE', 'DISABLED'];

// GET / — list users (ADMIN only)
router.get('/', authGuard, requireRole('ADMIN'), async (_req, res) => {
  const rows = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      username: true,
      roles: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Parse roles JSON strings into arrays for the response
  const items = rows.map((row) => ({
    ...row,
    roles: parseRoles(row.roles),
  }));

  res.json({ items });
});

// POST / — create user (ADMIN only)
router.post('/', authGuard, requireRole('ADMIN'), async (req, res) => {
  const { username, password, roles, status } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ message: 'username/password 不能为空' });
    return;
  }
  if (String(password).length < 8) {
    res.status(400).json({ message: '密码长度不能少于8位' });
    return;
  }

  const rolesArray: string[] = Array.isArray(roles) ? roles : roles ? [String(roles)] : ['VIEWER'];
  const invalidRoles = rolesArray.filter((r: string) => !VALID_ROLES.includes(r));
  if (invalidRoles.length > 0) {
    res.status(400).json({ message: `role 不合法: ${invalidRoles.join(', ')}` });
    return;
  }

  if (status && !VALID_STATUSES.includes(status)) {
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
      roles: JSON.stringify(rolesArray),
      status: status || 'ACTIVE',
    },
    select: {
      id: true,
      username: true,
      roles: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await writeAudit(req.user!.id, 'USER_CREATE', 'User', user.id, {
    username: user.username,
    roles: parseRoles(user.roles),
    status: user.status,
  });

  res.status(201).json({ ...user, roles: parseRoles(user.roles) });
});

// PATCH /:id — update user (ADMIN only)
router.patch('/:id', authGuard, requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const { roles, status, password } = req.body ?? {};

  const updates: Record<string, unknown> = {};
  if (roles !== undefined) {
    const rolesArray: string[] = Array.isArray(roles) ? roles : [String(roles)];
    const invalidRoles = rolesArray.filter((r: string) => !VALID_ROLES.includes(r));
    if (invalidRoles.length > 0) {
      res.status(400).json({ message: `role 不合法: ${invalidRoles.join(', ')}` });
      return;
    }
    updates.roles = JSON.stringify(rolesArray);
  }
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
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
    if (String(password).length < 8) {
      res.status(400).json({ message: '密码长度不能少于8位' });
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
      roles: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await writeAudit(req.user!.id, 'USER_UPDATE', 'User', user.id, {
    roles: updates.roles ? JSON.parse(updates.roles as string) : undefined,
    status: updates.status,
    passwordReset: updates.passwordHash ? true : false,
  });

  res.json({ ...user, roles: parseRoles(user.roles) });
});

export default router;
