import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';

/**
 * Middleware factory: writes an AuditLog entry after the response finishes.
 * Uses res.locals._auditWritten flag to avoid duplicate writes.
 */
export function auditLog(action: string, targetType: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Capture targetId from route params
    const targetId = req.params.id || req.params.instanceId || req.params.edgeId || '';

    res.on('finish', () => {
      // Only log successful responses (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        prisma.auditLog
          .create({
            data: {
              userId: req.user.id,
              action,
              targetType,
              targetId,
              payload: res.locals.auditPayload ?? null,
            },
          })
          .catch((err: Error) => {
            console.error('[AuditLog Error]', err);
          });
      }
    });

    next();
  };
}

/**
 * Direct write helper for routes that need audit logging with custom payload.
 */
export async function writeAudit(
  userId: string,
  action: string,
  targetType: string,
  targetId: string,
  payload: Record<string, unknown> | null = null
): Promise<void> {
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
