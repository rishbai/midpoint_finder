import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';

const SESSION_DAYS = 30;
const COOKIE_NAME = 'midpoint_session';

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

const insertSession = db.prepare(
  'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
);
const deleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');
const findSession = db.prepare(`
  SELECT s.expires_at, u.id, u.email, u.name, u.is_guest
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token = ?
`);

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  insertSession.run(token, userId, now.toISOString(), expires.toISOString());
  return { token, expiresAt: expires };
}

export function destroySession(token) {
  if (token) deleteSession.run(token);
}

export function userForSession(token) {
  if (!token) return null;
  const row = findSession.get(token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    deleteSession.run(token);
    return null;
  }
  // A guest's "email" is an unshown placeholder (see services/plans.js), not
  // something to surface anywhere a real email would be expected.
  return { id: row.id, email: row.is_guest ? null : row.email, name: row.name, isGuest: !!row.is_guest };
}

// Locally, frontend and API are same-origin (Vite proxies /api), so a plain
// Lax cookie over HTTP works. Deployed, they're on different domains (e.g.
// Vercel + Railway) — a cross-origin cookie needs SameSite=None, and browsers
// only honor SameSite=None when Secure is also set (HTTPS only). CLIENT_ORIGIN
// being set is exactly the signal for "this is a real cross-origin deployment."
const CROSS_ORIGIN = Boolean(process.env.CLIENT_ORIGIN);

function cookieOptions(expiresAt) {
  return {
    httpOnly: true,
    sameSite: CROSS_ORIGIN ? 'none' : 'lax',
    secure: CROSS_ORIGIN,
    expires: expiresAt,
  };
}

export function signIn(res, userId) {
  const { token, expiresAt } = createSession(userId);
  res.cookie(COOKIE_NAME, token, cookieOptions(expiresAt));
}

export function signOut(req, res) {
  destroySession(req.cookies?.[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME, cookieOptions(new Date(0)));
}

// Attaches req.user when a valid session cookie is present; never rejects.
export function attachUser(req, res, next) {
  req.user = userForSession(req.cookies?.[COOKIE_NAME]) || null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  next();
}
