import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, verifyPassword, signIn, signOut, requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

export const authRouter = Router();

const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const insertUser = db.prepare(
  'INSERT INTO users (id, email, password_hash, name, friend_invite_token, created_at) VALUES (?, ?, ?, ?, ?, ?)'
);

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name };
}

authRouter.post('/auth/signup', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();
    if (!email || !email.includes('@')) throw badRequest('Enter a valid email.');
    if (password.length < 8) throw badRequest('Password must be at least 8 characters.');
    if (!name) throw badRequest('Enter your name.');
    if (findByEmail.get(email)) throw badRequest('An account with that email already exists.');

    const id = crypto.randomUUID();
    insertUser.run(id, email, await hashPassword(password), name, crypto.randomBytes(8).toString('hex'), new Date().toISOString());
    signIn(res, id);
    res.status(201).json({ user: { id, email, name } });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = findByEmail.get(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw badRequest('Wrong email or password.');
    }
    signIn(res, user.id);
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/logout', (req, res) => {
  signOut(req, res);
  res.status(204).end();
});

authRouter.get('/auth/me', (req, res) => {
  res.json({ user: req.user });
});

authRouter.patch('/auth/me', requireAuth, (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) throw badRequest('Enter your name.');
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
    res.json({ user: { ...req.user, name } });
  } catch (err) {
    next(err);
  }
});

// Deleting your account takes everything with it: plans you host (and the
// participations in them, by cascade), your spots on other people's plans,
// friendships, sessions. If login lives in Supabase, the identity there goes
// too, so the email can be used again. Apple requires this to exist in-app
// for any app that lets people create an account.
const findSupabaseId = db.prepare('SELECT supabase_id FROM users WHERE id = ?');
authRouter.delete('/auth/me', requireAuth, async (req, res, next) => {
  try {
    const { supabase_id: supabaseId } = findSupabaseId.get(req.user.id) || {};
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    if (supabaseId && supabaseAdmin) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(supabaseId);
      if (error) console.warn('Supabase user deletion failed:', error.message);
    }
    signOut(req, res);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// A guest who joined via a plan's invite link can turn that same account into
// a real one — same user id, same plans/history, just adds a real login.
authRouter.post('/auth/upgrade', requireAuth, async (req, res, next) => {
  try {
    if (!req.user.isGuest) throw badRequest('This account already has a password.');
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !email.includes('@')) throw badRequest('Enter a valid email.');
    if (password.length < 8) throw badRequest('Password must be at least 8 characters.');
    if (findByEmail.get(email)) throw badRequest('An account with that email already exists.');

    db.prepare('UPDATE users SET email = ?, password_hash = ?, is_guest = 0 WHERE id = ?').run(
      email,
      await hashPassword(password),
      req.user.id
    );
    res.json({ user: { id: req.user.id, email, name: req.user.name } });
  } catch (err) {
    next(err);
  }
});
