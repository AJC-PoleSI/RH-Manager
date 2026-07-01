import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import candidateRoutes from './routes/candidateRoutes';
import memberRoutes from './routes/memberRoutes';
import epreuveRoutes from './routes/epreuveRoutes';
import evaluationRoutes from './routes/evaluationRoutes';
import deliberationRoutes from './routes/deliberationRoutes';
import kpiRoutes from './routes/kpiRoutes';
import availabilityRoutes from './routes/availabilityRoutes';
import calendarRoutes from './routes/calendarRoutes';
import planningRoutes from './routes/planningRoutes';
import settingsRoutes from './routes/settingsRoutes';
import wishRoutes from './routes/wishRoutes';
import slotRoutes from './routes/slotRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === 'production';

// Derrière un proxy (Vercel/nginx), fait confiance au premier hop pour que
// req.ip reflète l'IP client réelle (nécessaire au rate-limiting).
if (isProd) app.set('trust proxy', 1);
app.disable('x-powered-by');

// En-têtes de sécurité (équivalent minimal de helmet, sans dépendance externe).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
});

// SECURITY: Restrict CORS to allowed origins only
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // En prod, on ne reflète pas les requêtes sans Origin ; en dev on tolère
    // (curl, tests). Les clients non-navigateur n'appliquent pas le CORS de
    // toute façon — l'autorisation réelle passe par le JWT.
    if (!origin) return callback(null, !isProd);
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));

// Rate-limiter en mémoire (anti brute-force sur l'authentification). Sans
// dépendance : suffisant pour une instance ; passer à un store partagé (Redis)
// si l'API est scalée horizontalement.
function createRateLimiter(opts: { windowMs: number; max: number; keyPrefix?: string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = (opts.keyPrefix || '') + ip;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Trop de tentatives, réessayez plus tard.' });
    }
    next();
  };
}
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'auth:' });

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/epreuves', epreuveRoutes);
app.use('/api/evaluations', evaluationRoutes);
app.use('/api/deliberations', deliberationRoutes);
app.use('/api/kpis', kpiRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/planning', planningRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/wishes', wishRoutes);
app.use('/api/slots', slotRoutes);

app.get('/', (req, res) => {
    res.send('RH Manager Backend API is running.');
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

export default app;
