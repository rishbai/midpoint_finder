import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { venuesRouter } from './routes/venues.js';
import { meetupRouter } from './routes/meetup.js';
import { authRouter } from './routes/auth.js';
import { friendsRouter } from './routes/friends.js';
import { plansRouter } from './routes/plans.js';
import { queryRouter } from './routes/query.js';
import { attachUser } from './lib/auth.js';

const app = express();
app.disable('etag'); // this is a per-session, always-dynamic API — no conditional caching semantics apply

// This API is proxied through Vercel's edge network in production (see
// client/vercel.json), which can cache and replay GET responses by URL —
// dangerous here, since /api/plans/:id/results is the same URL every time
// regardless of who's asking or what just changed (a new location share, a
// new "Find spots" run). Force every response to skip that layer entirely.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// In dev, Vite proxies /api to this server, so the browser never sees a
// cross-origin request — CORS is a no-op there. In production the frontend
// (e.g. Vercel) and this API (e.g. Railway) are on different domains, so the
// browser needs an explicit allow-list, and it must include credentials
// (cookies) or the session simply won't work. Comma-separate for multiple
// origins (e.g. a custom domain plus a Vercel preview URL).
const allowedOrigins = (process.env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
// The native app (Capacitor) loads from its own scheme rather than a
// website, so these are always welcome; a browser can't forge them.
const NATIVE_ORIGINS = ['capacitor://localhost', 'ionic://localhost', 'http://localhost'];
allowedOrigins.push(...NATIVE_ORIGINS);
if (allowedOrigins.length > NATIVE_ORIGINS.length) {
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }));
} else {
  console.warn('CLIENT_ORIGIN is not set — CORS is unrestricted. Fine for local dev; set it before deploying (see README).');
}

app.use(express.json());
app.use(cookieParser());
app.use(attachUser);

// Basic abuse/cost safety net — generous enough that a handful of friends
// actually using the app together never notices it.
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth/signup', authLimiter);
app.use('/api/auth/login', authLimiter);

// The two endpoints that spend money on someone else's behalf: ranking a plan
// buys a travel-time matrix per mode, and the anonymous meetup does the same
// with no account behind it. Repeats are cached (see services/plans.js), so
// this only bites on genuinely new searches — which is exactly what to cap.
const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'That is a lot of searching. Give it a few minutes.' },
});
app.use('/api/meetup', searchLimiter);
app.use(/^\/api\/plans\/[^/]+\/(results|routes)/, searchLimiter);

app.use('/api', venuesRouter);
app.use('/api', meetupRouter);
app.use('/api', authRouter);
app.use('/api', friendsRouter);
app.use('/api', plansRouter);
app.use('/api', queryRouter);

// Express 5 forwards async errors here automatically.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
