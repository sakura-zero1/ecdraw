import { Router } from 'express';
import { authGuard, requireRole } from '../middleware/auth.js';

const router = Router();

// Placeholder routes — returning 501 Not Implemented

// POST /outage-simulate — simulate power outage
router.post('/outage-simulate', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), (_req, res) => {
  res.status(501).json({ message: '停电模拟功能尚未实现' });
});

// POST /power-flow — power flow calculation
router.post('/power-flow', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), (_req, res) => {
  res.status(501).json({ message: '潮流计算功能尚未实现' });
});

// POST /fault-analysis — fault analysis
router.post('/fault-analysis', authGuard, requireRole('ADMIN', 'DIAGRAM_EDITOR'), (_req, res) => {
  res.status(501).json({ message: '故障分析功能尚未实现' });
});

export default router;
