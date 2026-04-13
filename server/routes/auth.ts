import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma.js';
import { ACCESS_SECRET, REFRESH_SECRET, parseRoles } from '../middleware/auth.js';

const router = Router();

interface TokenUser {
  id: string;
  username: string;
  roles: string[];
}

function issueTokens(user: { id: string; username: string; roles: string }) {
  const payload: TokenUser = {
    id: user.id,
    username: user.username,
    roles: parseRoles(user.roles),
  };
  const accessToken = jwt.sign(payload, ACCESS_SECRET, { expiresIn: '1h' });
  const refreshToken = jwt.sign(payload, REFRESH_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

// POST /login
router.post('/login', async (req, res) => {
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
  const roles = parseRoles(user.roles);
  res.json({
    ...tokens,
    user: { id: user.id, username: user.username, roles },
  });
});

// POST /refresh
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) {
    res.status(400).json({ message: 'refreshToken 不能为空' });
    return;
  }

  try {
    const payload = jwt.verify(String(refreshToken), REFRESH_SECRET) as TokenUser;
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user || user.status !== 'ACTIVE') {
      res.status(401).json({ message: '用户不可用' });
      return;
    }

    const tokens = issueTokens(user);
    const roles = parseRoles(user.roles);
    res.json({
      ...tokens,
      user: { id: user.id, username: user.username, roles },
    });
  } catch {
    res.status(401).json({ message: 'refreshToken 无效或已过期' });
  }
});

export default router;
