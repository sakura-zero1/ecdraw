import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { errorHandler } from './utils/errors.js';
import { prisma } from './utils/prisma.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import componentRoutes from './routes/components.js';
import diagramRoutes from './routes/diagrams.js';
import districtRoutes from './routes/districts.js';
import lineRoutes from './routes/lines.js';
import gisRoutes from './routes/gis.js';
import reviewRoutes from './routes/reviews.js';
import auditRoutes from './routes/audits.js';
import analysisRoutes from './routes/analysis.js';

const app = express();
const PORT = Number(process.env.API_PORT ?? 3001);

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function isAllowedOrigin(origin: string | undefined): boolean {
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

// Health check
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'up' });
  } catch (err) {
    res.status(500).json({ ok: false, db: 'down', error: String(err) });
  }
});

// Mount route modules
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/components', componentRoutes);
app.use('/api/diagrams', diagramRoutes);
app.use('/api/districts', districtRoutes);
app.use('/api/lines', lineRoutes);
app.use('/api/gis', gisRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/audits', auditRoutes);
app.use('/api/analysis', analysisRoutes);

// Global error handler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[ECDraw API] http://localhost:${PORT}`);
});
