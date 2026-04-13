import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

if (!process.env.JWT_ACCESS_SECRET) {
  console.warn('[WARN] JWT_ACCESS_SECRET not set, using default. Set this in production!');
}
if (!process.env.JWT_REFRESH_SECRET) {
  console.warn('[WARN] JWT_REFRESH_SECRET not set, using default. Set this in production!');
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev_access_secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret';

export { ACCESS_SECRET, REFRESH_SECRET };

export interface JwtPayload {
  id: string;
  username: string;
  roles: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** Parse User.roles JSON string field into string[] */
export function parseRoles(rolesField: string): string[] {
  try {
    const parsed = JSON.parse(rolesField);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // fallback: treat as single role string
  }
  return [rolesField];
}

export function authGuard(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ message: '缺少鉴权令牌' });
    return;
  }
  const token = auth.slice(7).trim();
  try {
    const payload = jwt.verify(token, ACCESS_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: '令牌无效或已过期' });
  }
}

/**
 * Multi-role check: pass if req.user.roles includes ANY of the required roles (OR logic).
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: '未认证' });
      return;
    }
    const hasRole = req.user.roles.some((r) => roles.includes(r));
    if (!hasRole) {
      res.status(403).json({ message: '无权限访问' });
      return;
    }
    next();
  };
}
