import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../lib/auth.js';

export const friendsRouter = Router();
// requireAuth is applied per-route below (not via router.use), because this
// router is mounted at the shared '/api' prefix alongside public routers like
// queryRouter. A blanket router.use() here would intercept ANY unmatched
// '/api/*' request that reaches this router in the middleware chain — not
// just this file's own routes — and reject it before it ever reaches a
// sibling router mounted later.

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

const findUserByEmail = db.prepare('SELECT id, email, name FROM users WHERE email = ?');
const findUserByInviteToken = db.prepare('SELECT id, name FROM users WHERE friend_invite_token = ?');
const getInviteToken = db.prepare('SELECT friend_invite_token FROM users WHERE id = ?');
const findFriendship = db.prepare(`
  SELECT * FROM friendships
  WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
`);
const insertFriendship = db.prepare(
  'INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, ?, ?)'
);
const acceptFriendship = db.prepare(
  "UPDATE friendships SET status = 'accepted' WHERE id = ? AND addressee_id = ?"
);
const declineFriendship = db.prepare(
  'DELETE FROM friendships WHERE id = ? AND (requester_id = ? OR addressee_id = ?)'
);

// Shared by the email-based request and the invite-link request below.
function requestFriendship(requesterId, addresseeId) {
  if (requesterId === addresseeId) throw badRequest("That's you.");
  const existing = findFriendship.get(requesterId, addresseeId, addresseeId, requesterId);
  if (existing) {
    if (existing.status === 'accepted') throw badRequest('Already friends.');
    throw badRequest('A request is already pending.');
  }
  insertFriendship.run(requesterId, addresseeId, 'pending', new Date().toISOString());
}

// People search, so you can invite someone by email without a friend request first.
friendsRouter.get('/users/search', requireAuth, (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) return res.json({ results: [] });
  const rows = db
    .prepare('SELECT id, email, name FROM users WHERE email LIKE ? AND id != ? LIMIT 10')
    .all(`%${email}%`, req.user.id);
  res.json({ results: rows });
});

friendsRouter.get('/friends', requireAuth, (req, res) => {
  const accepted = db.prepare(`
    SELECT u.id, u.email, u.name FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
    WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'
    ORDER BY u.name
  `).all(req.user.id, req.user.id, req.user.id);

  const incoming = db.prepare(`
    SELECT f.id, u.id AS user_id, u.email, u.name FROM friendships f
    JOIN users u ON u.id = f.requester_id
    WHERE f.addressee_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `).all(req.user.id);

  const outgoing = db.prepare(`
    SELECT f.id, u.id AS user_id, u.email, u.name FROM friendships f
    JOIN users u ON u.id = f.addressee_id
    WHERE f.requester_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `).all(req.user.id);

  const inviteToken = getInviteToken.get(req.user.id)?.friend_invite_token;
  res.json({ friends: accepted, incoming, outgoing, inviteToken });
});

friendsRouter.post('/friends/requests', requireAuth, (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const target = findUserByEmail.get(email);
    if (!target) throw badRequest('No account with that email.');
    requestFriendship(req.user.id, target.id);
    res.status(201).json({ user: target });
  } catch (err) {
    next(err);
  }
});

// Public preview of a personal invite link — no auth, just who it's from.
friendsRouter.get('/friends/invite/:token', (req, res, next) => {
  try {
    const inviter = findUserByInviteToken.get(req.params.token);
    if (!inviter) throw badRequest("This invite link isn't valid.");
    res.json({ inviterName: inviter.name });
  } catch (err) {
    next(err);
  }
});

// Accepting one requires a real login (not a plan-style guest) — friendship
// is a lasting identity, not a one-off. Lands as a normal pending request in
// the inviter's incoming list, same as the email-based flow above.
friendsRouter.post('/friends/invite/:token', requireAuth, (req, res, next) => {
  try {
    const inviter = findUserByInviteToken.get(req.params.token);
    if (!inviter) throw badRequest("This invite link isn't valid.");
    requestFriendship(req.user.id, inviter.id);
    res.status(201).json({ inviterName: inviter.name });
  } catch (err) {
    next(err);
  }
});

friendsRouter.post('/friends/requests/:id/accept', requireAuth, (req, res) => {
  const result = acceptFriendship.run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Request not found.' });
  res.status(204).end();
});

friendsRouter.post('/friends/requests/:id/decline', requireAuth, (req, res) => {
  const result = declineFriendship.run(req.params.id, req.user.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Request not found.' });
  res.status(204).end();
});
