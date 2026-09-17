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

// In dev, Vite proxies /api to this server, so the browser never sees a
// cross-origin request — CORS is a no-op there. In production the frontend
// (e.g. Vercel) and this API (e.g. Railway) are on different domains, so the
// browser needs an explicit allow-list, and it must include credentials
// (cookies) or the session simply won't work. Comma-separate for multiple
// origins (e.g. a custom domain plus a Vercel preview URL).
const allowedOrigins = (process.env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
if (allowedOrigins.length) {
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
