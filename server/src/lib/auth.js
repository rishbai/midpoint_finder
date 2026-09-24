import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createRemoteJWKSet, jwtVerify } from 'jose';
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
  SELECT s.expires_at, u.id, u.email, u.name, u.is_guest, u.supabase_id
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token = ?
`);

// A guest's "email" is an unshown placeholder (see services/plans.js), not
// something to surface anywhere a real email would be expected.
const publicUser = (row) => ({
  id: row.id,
  email: row.is_guest ? null : row.email,
  name: row.name,
  isGuest: !!row.is_guest,
});

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
  return publicUser(row);
}

// Locally, frontend and API are same-origin (Vite proxies /api), so a plain
// Lax cookie over HTTP works. Deployed, they're on different domains (e.g.
// Vercel + Railway): a cross-origin cookie needs SameSite=None, and browsers
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

// ---- Supabase Auth ---------------------------------------------------------
//
// Login can live in Supabase instead of here: the client signs in with
// Supabase directly and sends its access token as a bearer, and this server
// only verifies the token and keeps its own users row for the person. Both
// paths work at once, so the website keeps its cookie sessions until the
// switch is flipped, and the native app (where cookies don't work) uses
// tokens from day one.
//
// Env: SUPABASE_URL always. Newer projects sign tokens with a key pair and
// publish the public half at /auth/v1/.well-known/jwks.json; older ones use
// a shared secret, set as SUPABASE_JWT_SECRET. Either works.

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
export const SUPABASE_ENABLED = Boolean(SUPABASE_URL);

const jwks = SUPABASE_ENABLED && !SUPABASE_JWT_SECRET
  ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
  : null;

async function verifySupabaseToken(token) {
  const options = { issuer: `${SUPABASE_URL}/auth/v1`, audience: 'authenticated' };
  const { payload } = SUPABASE_JWT_SECRET
    ? await jwtVerify(token, new TextEncoder().encode(SUPABASE_JWT_SECRET), options)
    : await jwtVerify(token, jwks, options);
  return payload;
}

const findBySupabaseId = db.prepare('SELECT * FROM users WHERE supabase_id = ?');
const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const insertSupabaseUser = db.prepare(`
  INSERT INTO users (id, email, password_hash, name, is_guest, friend_invite_token, supabase_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const linkSupabaseId = db.prepare('UPDATE users SET supabase_id = ? WHERE id = ?');
const promoteUser = db.prepare('UPDATE users SET is_guest = 0, email = ?, name = ? WHERE id = ?');

// The person behind a verified token, as a users row, created on first sight.
// An anonymous Supabase user (someone who joined by invite link) is a guest
// here; when they later add an email and password, their next token says so
// and the row is promoted in place, keeping their plans.
function userForClaims(claims) {
  const supabaseId = claims.sub;
  const anonymous = claims.is_anonymous === true;
  const email = claims.email || null;
  const name = String(claims.user_metadata?.name || '').trim() || (email ? email.split('@')[0] : 'Guest');

  let row = findBySupabaseId.get(supabaseId);

  // Same email as an account made before the move to Supabase: that's the
  // same person, so link rather than duplicate (see scripts/migrate-users.js).
  if (!row && email) {
    const existing = findByEmail.get(email);
    if (existing && !existing.supabase_id) {
      linkSupabaseId.run(supabaseId, existing.id);
      row = findBySupabaseId.get(supabaseId);
    }
  }

  if (!row) {
    const id = crypto.randomUUID();
    insertSupabaseUser.run(
      id,
      email || `guest-${id}@guest.midpoint.local`,
      crypto.randomBytes(32).toString('hex'), // never used; the password lives in Supabase
      name,
      anonymous ? 1 : 0,
      crypto.randomBytes(8).toString('hex'),
      supabaseId,
      new Date().toISOString()
    );
    row = findBySupabaseId.get(supabaseId);
  } else if (row.is_guest && !anonymous && email) {
    promoteUser.run(email, name, row.id);
    row = findBySupabaseId.get(supabaseId);
  }
  return publicUser(row);
}

// Attaches req.user from either a session cookie or a Supabase bearer token;
// never rejects on its own (requireAuth does that where it matters).
export async function attachUser(req, res, next) {
  req.user = userForSession(req.cookies?.[COOKIE_NAME]) || null;
  if (!req.user && SUPABASE_ENABLED) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      try {
        req.user = userForClaims(await verifySupabaseToken(token));
      } catch {
        req.user = null; // expired or forged: treated as signed out
      }
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  next();
}
