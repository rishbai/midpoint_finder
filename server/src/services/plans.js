import crypto from 'node:crypto';
import { db } from '../db.js';
import { geocode, getRoute, pickBestLeg } from './google.js';
import { rankVenuesForPeople, MAX_PEOPLE } from './meetup.js';
import { normalizeFilters, getVenue } from './search.js';
import { describeForQuery } from './describe.js';
import { normalizeTravelModes, googleTransitTypes, usesWalk, usesDrive, usesTransit } from '../lib/travelModes.js';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}
function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}
function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

const insertPlan = db.prepare(`
  INSERT INTO plans (id, host_id, title, query_text, filters, planned_for, status, share_token, created_at)
  VALUES (@id, @host_id, @title, @query_text, @filters, @planned_for, 'gathering', @share_token, @created_at)
`);
const insertGuestUser = db.prepare(`
  INSERT INTO users (id, email, password_hash, name, is_guest, friend_invite_token, travel_modes, created_at)
  VALUES (?, ?, ?, ?, 1, ?, ?, ?)
`);
const setUserTravelModes = db.prepare('UPDATE users SET travel_modes = ? WHERE id = ?');
const getPlanByToken = db.prepare('SELECT * FROM plans WHERE share_token = ?');
const getUserName = db.prepare('SELECT name FROM users WHERE id = ?');
const insertParticipant = db.prepare(`
  INSERT INTO plan_participants (plan_id, user_id, status) VALUES (?, ?, ?)
`);
const insertPlacedParticipant = db.prepare(`
  INSERT INTO plan_participants (plan_id, user_id, status, lat, lng, address, shared_at, travel_modes, added_by_host)
  VALUES (?, ?, 'joined', ?, ?, ?, ?, ?, 1)
`);
const setParticipantTravelModesStmt = db.prepare(
  'UPDATE plan_participants SET travel_modes = ? WHERE plan_id = ? AND user_id = ?'
);
const getPlanRow = db.prepare('SELECT * FROM plans WHERE id = ?');
const getParticipant = db.prepare('SELECT * FROM plan_participants WHERE plan_id = ? AND user_id = ?');
const listParticipants = db.prepare(`
  SELECT p.user_id, p.status, p.lat, p.lng, p.address, p.shared_at, p.added_by_host,
         u.name,
         -- Per-plan preference wins; NULL falls back to the account default.
         COALESCE(p.travel_modes, u.travel_modes) AS travel_modes,
         p.travel_modes IS NOT NULL AS travel_modes_set,
         -- a guest's email is an internal placeholder (see joinPlanByToken), never real
         CASE WHEN u.is_guest THEN NULL ELSE u.email END AS email
  FROM plan_participants p JOIN users u ON u.id = p.user_id
  WHERE p.plan_id = ?
  ORDER BY (p.user_id = (SELECT host_id FROM plans WHERE id = p.plan_id)) DESC, u.name
`);
const setParticipantStatus = db.prepare(
  'UPDATE plan_participants SET status = ? WHERE plan_id = ? AND user_id = ?'
);
const setParticipantLocation = db.prepare(`
  UPDATE plan_participants SET status = 'joined', lat = ?, lng = ?, address = ?, shared_at = ?
  WHERE plan_id = ? AND user_id = ?
`);
const deletePlanStmt = db.prepare('DELETE FROM plans WHERE id = ? AND host_id = ?');
const updatePlanStmt = db.prepare(`
  UPDATE plans SET title = ?, query_text = ?, filters = ?, planned_for = ?, resolved_modes = NULL
  WHERE id = ? AND host_id = ?
`);
const deleteParticipant = db.prepare('DELETE FROM plan_participants WHERE plan_id = ? AND user_id = ?');
const saveResolvedModes = db.prepare('UPDATE plans SET resolved_modes = ? WHERE id = ?');
const clearResolvedModes = db.prepare('UPDATE plans SET resolved_modes = NULL WHERE id = ?');

const VALID_MODES = ['TRANSIT', 'WALK', 'DRIVE'];
function parseResolvedModes(json) {
  if (!json) return null;
  try {
    const modes = JSON.parse(json).filter((m) => VALID_MODES.includes(m));
    return modes.length ? modes : null;
  } catch {
    return null;
  }
}

function requireParticipantOrHost(plan, userId) {
  if (plan.host_id === userId) return;
  const p = getParticipant.get(plan.id, userId);
  if (!p) throw forbidden("You're not part of this plan.");
}

export function createPlan({ hostId, title, queryText, filters, plannedFor, friendIds = [] }) {
  const cleanTitle = String(title || '').trim() || 'Untitled plan';
  const uniqueFriends = [...new Set((friendIds || []).filter((id) => id && id !== hostId))];
  if (uniqueFriends.length + 1 > MAX_PEOPLE) {
    throw badRequest(`Up to ${MAX_PEOPLE} people per plan for now.`);
  }

  const id = crypto.randomUUID();
  const create = db.transaction(() => {
    insertPlan.run({
      id,
      host_id: hostId,
      title: cleanTitle,
      query_text: queryText || null,
      // Normalized so searchVenues always gets the shape it expects (vibes: [], sort, etc),
      // regardless of what the client sent — the client may pass raw /api/query filters
      // or hand-built ones.
      filters: JSON.stringify(normalizeFilters(filters || {})),
      planned_for: plannedFor || null,
      share_token: crypto.randomBytes(8).toString('hex'),
      created_at: new Date().toISOString(),
    });
    insertParticipant.run(id, hostId, 'joined');
    for (const friendId of uniqueFriends) insertParticipant.run(id, friendId, 'invited');
  });
  create();

  return getPlan(id, hostId);
}

// Public preview shown before anyone commits to joining — no auth, so it
// can't leak more than title/host/headcount.
export function getPlanPreviewByToken(token) {
  const plan = getPlanByToken.get(token);
  if (!plan) throw notFound("This invite link isn't valid.");
  const host = getUserName.get(plan.host_id);
  const participantCount = db
    .prepare('SELECT COUNT(*) c FROM plan_participants WHERE plan_id = ?')
    .get(plan.id).c;
  return { title: plan.title, hostName: host?.name || 'Someone', participantCount };
}

// Opening a plan's invite link: a signed-in visitor (real account or an
// existing guest) is added directly; an anonymous visitor gives just a name
// and gets a lightweight guest account created on the spot (see lib/auth.js
// signIn — same session mechanism as a real login, so every other plan
// endpoint works for them unchanged; no password, no email shown anywhere).
export function joinPlanByToken(token, { userId, name, travelModes }) {
  const plan = getPlanByToken.get(token);
  if (!plan) throw notFound("This invite link isn't valid.");

  let finalUserId = userId;
  let isNewGuest = false;
  if (!finalUserId) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw badRequest('Enter your name to join.');
    finalUserId = crypto.randomUUID();
    const placeholderEmail = `guest-${finalUserId}@guest.midpoint.local`;
    const placeholderHash = crypto.randomBytes(32).toString('hex'); // never given out; can't be used to log in
    insertGuestUser.run(
      finalUserId,
      placeholderEmail,
      placeholderHash,
      cleanName,
      crypto.randomBytes(8).toString('hex'),
      JSON.stringify(normalizeTravelModes(travelModes)),
      new Date().toISOString()
    );
    isNewGuest = true;
  }

  const existingCount = db.prepare('SELECT COUNT(*) c FROM plan_participants WHERE plan_id = ?').get(plan.id).c;
  const alreadyIn = getParticipant.get(plan.id, finalUserId);
  if (!alreadyIn) {
    if (existingCount >= MAX_PEOPLE) throw badRequest(`This plan already has ${MAX_PEOPLE} people.`);
    insertParticipant.run(plan.id, finalUserId, 'joined');
  }
  // The answer given on the way in is about this trip, so it's stored on the
  // participation. A brand-new guest has no account default yet, so seed that
  // too and their next plan starts from the same sensible place.
  if (travelModes !== undefined) {
    const modes = JSON.stringify(normalizeTravelModes(travelModes));
    setParticipantTravelModesStmt.run(modes, plan.id, finalUserId);
    if (isNewGuest) setUserTravelModes.run(modes, finalUserId);
  }

  return { userId: finalUserId, isNewGuest, plan: getPlan(plan.id, finalUserId) };
}

export function listPlansForUser(userId) {
  return db.prepare(`
    SELECT pl.id, pl.title, pl.query_text, pl.planned_for, pl.status, pl.created_at,
           pl.host_id, hu.name AS host_name,
           pp.status AS my_status,
           (SELECT COUNT(*) FROM plan_participants WHERE plan_id = pl.id) AS participant_count,
           (SELECT COUNT(*) FROM plan_participants WHERE plan_id = pl.id AND lat IS NOT NULL) AS shared_count
    FROM plan_participants pp
    JOIN plans pl ON pl.id = pp.plan_id
    JOIN users hu ON hu.id = pl.host_id
    WHERE pp.user_id = ?
    ORDER BY pl.created_at DESC
  `).all(userId);
}

export function getPlan(planId, userId) {
  const plan = getPlanRow.get(planId);
  if (!plan) throw notFound('Plan not found.');
  requireParticipantOrHost(plan, userId);
  return {
    id: plan.id,
    title: plan.title,
    queryText: plan.query_text,
    filters: JSON.parse(plan.filters),
    plannedFor: plan.planned_for,
    status: plan.status,
    hostId: plan.host_id,
    shareToken: plan.share_token,
    createdAt: plan.created_at,
    participants: listParticipants.all(planId).map((p) => ({
      userId: p.user_id,
      name: p.name,
      email: p.email,
      status: p.status,
      travelModes: normalizeTravelModes(p.travel_modes),
      // Whether they've said so for *this* plan, or we're showing their default.
      travelModesSet: !!p.travel_modes_set,
      addedByHost: !!p.added_by_host,
      hasLocation: p.lat != null,
      lat: p.lat,
      lng: p.lng,
      address: p.address,
      sharedAt: p.shared_at,
    })),
  };
}

// How one person is travelling for this plan specifically. Stored on the
// participation, not the account: the same person takes the subway at home
// and drives when they're visiting family, and neither answer is wrong.
export function setParticipantTravelModes(planId, actorId, targetUserId, travelModes) {
  const plan = getPlanRow.get(planId);
  if (!plan) throw notFound('Plan not found.');
  requireParticipantOrHost(plan, actorId);

  const target = getParticipant.get(planId, targetUserId);
  if (!target) throw notFound("That person isn't on this plan.");
  // Your own, always. The host also keeps the details of the people they
  // added by address, since those people have no account to do it themselves.
  const mine = actorId === targetUserId;
  const hostManaging = plan.host_id === actorId && target.added_by_host;
  if (!mine && !hostManaging) throw forbidden("You can only change how you're getting there.");

  setParticipantTravelModesStmt.run(JSON.stringify(normalizeTravelModes(travelModes)), planId, targetUserId);
  clearResolvedModes.run(planId); // times were priced under the old preference
  return getPlan(planId, actorId);
}

// Adds someone who isn't signing up for anything: the host types a name and
// where they're coming from, and they count in the ranking like everyone
// else. They get a placeholder account purely so the rest of the app has a
// person to hang a row on — no password, no email, no way to log in as them.
export async function addPersonByAddress(planId, hostId, { name, address, travelModes }) {
  const plan = getPlanRow.get(planId);
  if (!plan) throw notFound('Plan not found.');
  if (plan.host_id !== hostId) throw forbidden('Only the host can add people to this plan.');

  const cleanName = String(name || '').trim();
  const cleanAddress = String(address || '').trim();
  if (!cleanName) throw badRequest('Give this person a name.');
  if (!cleanAddress) throw badRequest('Add where they\'re coming from.');

  const count = db.prepare('SELECT COUNT(*) c FROM plan_participants WHERE plan_id = ?').get(planId).c;
  if (count >= MAX_PEOPLE) throw badRequest(`This plan already has ${MAX_PEOPLE} people.`);

  // Geocode before writing anything, so a bad address fails cleanly rather
  // than leaving a placeholder account behind with nowhere to travel from.
  const located = await geocode(cleanAddress);

  const userId = crypto.randomUUID();
  db.transaction(() => {
    insertGuestUser.run(
      userId,
      `guest-${userId}@guest.midpoint.local`,
      crypto.randomBytes(32).toString('hex'), // never given out; can't be used to log in
      cleanName,
      crypto.randomBytes(8).toString('hex'),
      JSON.stringify(normalizeTravelModes(travelModes)),
      new Date().toISOString()
    );
    insertPlacedParticipant.run(
      planId,
      userId,
      located.lat,
      located.lng,
      located.address || cleanAddress,
      new Date().toISOString(),
      JSON.stringify(normalizeTravelModes(travelModes))
    );
  })();
  clearResolvedModes.run(planId);

  return getPlan(planId, hostId);
}

export function updatePlan(planId, userId, { title, queryText, filters, plannedFor }) {
  const plan = getPlanRow.get(planId);
  if (!plan) throw notFound('Plan not found.');
  if (plan.host_id !== userId) throw forbidden('Only the host can edit this plan.');

  updatePlanStmt.run(
    String(title || '').trim() || plan.title,
    queryText !== undefined ? (queryText || null) : plan.query_text,
    filters !== undefined ? JSON.stringify(normalizeFilters(filters || {})) : plan.filters,
    plannedFor !== undefined ? (plannedFor || null) : plan.planned_for,
    planId,
    userId
  );
  return getPlan(planId, userId);
}

export function deletePlan(planId, userId) {
  const plan = getPlanRow.get(planId);
  if (!plan) throw notFound('Plan not found.');
  if (plan.host_id !== userId) throw forbidden('Only the host can delete this plan.');
  deletePlanStmt.run(planId, userId); // plan_participants cascade on delete
}

export function inviteToPlan(planId, userId, friendIds = []) {
  const plan = getPlanRow.get(planId);
  if (!plan) throw notFound('Plan not found.');
  if (plan.host_id !== userId) throw forbidden('Only the host can invite people.');

  const existingIds = new Set(listParticipants.all(planId).map((p) => p.user_id));
  const toAdd = [...new Set((friendIds || []).filter((id) => id && !existingIds.has(id)))];
  if (existingIds.size + toAdd.length > MAX_PEOPLE) {
    throw badRequest(`Up to ${MAX_PEOPLE} people per plan for now.`);
  }

  const run = db.transaction(() => {
    for (const id of toAdd) insertParticipant.run(planId, id, 'invited');
  });
  run();
  return getPlan(planId, userId);
}

// The host can't leave their own plan — deleting it is the equivalent action.
export function leavePlan(planId, userId) {
  const plan = getPlanRow.get(planId);
  if (!plan) throw notFound('Plan not found.');
  if (plan.host_id === userId) throw badRequest("The host can't leave — delete the plan instead.");
  const result = deleteParticipant.run(planId, userId);
  if (result.changes === 0) throw forbidden("You're not part of this plan.");
}

export function respondToPlan(planId, userId, action) {
  const plan = getPlanRow.get(planId);
  if (!plan) throw notFound('Plan not found.');
  const participant = getParticipant.get(planId, userId);
  if (!participant) throw forbidden("You weren't invited to this plan.");
  if (!['joined', 'declined'].includes(action)) throw badRequest('Invalid response.');
  setParticipantStatus.run(action, planId, userId);
  return getPlan(planId, userId);
}

export async function shareLocation(planId, userId, { lat, lng, address }) {
  const plan = getPlanRow.get(planId);
  if (!plan) throw notFound('Plan not found.');
  const participant = getParticipant.get(planId, userId);
  if (!participant) throw forbidden("You weren't invited to this plan.");

  let point;
  if (lat != null && lng != null) {
    point = { lat: Number(lat), lng: Number(lng), address: address || null };
  } else if (address) {
    const geocoded = await geocode(String(address));
    point = { lat: geocoded.lat, lng: geocoded.lng, address: geocoded.address };
  } else {
    throw badRequest('Share your location or type an address.');
  }

  setParticipantLocation.run(point.lat, point.lng, point.address, new Date().toISOString(), planId, userId);
  return getPlan(planId, userId);
}

// Computed on demand (not cached) since it costs a Routes API call per refresh.
export async function computePlanResults(planId, userId) {
  const plan = getPlanRow.get(planId);
  if (!plan) throw notFound('Plan not found.');
  requireParticipantOrHost(plan, userId);

  const withLocation = listParticipants
    .all(planId)
    .filter((p) => p.lat != null && p.status !== 'declined');
  if (withLocation.length < 2) {
    throw badRequest('At least two people need to share their location first.');
  }

  const people = withLocation.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    userId: p.user_id,
    name: p.name,
    travelModes: normalizeTravelModes(p.travel_modes),
  }));
  const filters = JSON.parse(plan.filters);
  const { center, results, note, modesUsed } = await rankVenuesForPeople(people, filters, plan.planned_for);
  // Remember what got priced, so tapping into a venue shows directions in the
  // same mode the times above were quoted in (see getPlanVenueRoutes).
  if (modesUsed?.length) saveResolvedModes.run(JSON.stringify(modesUsed), planId);

  // Ground each venue's description in what this plan actually asked for
  // ("a quiet spot to work" -> "outlets at every table"), not a generic category line.
  const descriptions = await describeForQuery(plan.query_text, results.map((r) => r.venue));
  const described = results.map((r) => ({
    ...r,
    venue: { ...r.venue, description: descriptions[r.venue.id] || null },
  }));

  return { people, center, results: described, note };
}

// Step-by-step directions for one venue, per participant — only fetched when
// someone actually clicks in to see them, not for the whole shortlist.
export async function getPlanVenueRoutes(planId, userId, venueId) {
  const plan = getPlanRow.get(planId);
  if (!plan) throw notFound('Plan not found.');
  requireParticipantOrHost(plan, userId);

  const venue = getVenue(venueId);
  if (!venue) throw notFound('Venue not found.');

  const withLocation = listParticipants
    .all(planId)
    .filter((p) => p.lat != null && p.status !== 'declined');

  // Whether driving got priced is a judgement about the whole shortlist, so
  // it can't be re-derived from one leg without contradicting the list people
  // tapped in from — the ranking records it (see computePlanResults).
  const priced = parseResolvedModes(plan.resolved_modes);

  const routes = await Promise.all(
    withLocation.map(async (p) => {
      const origin = { lat: p.lat, lng: p.lng };
      const destination = { lat: venue.lat, lng: venue.lng };

      // This person's own modes, narrowed to what the ranking actually
      // priced, so their directions match the time they tapped.
      const travelModes = normalizeTravelModes(p.travel_modes);
      const mine = [
        usesWalk(travelModes) && 'WALK',
        usesTransit(travelModes) && 'TRANSIT',
        usesDrive(travelModes) && 'DRIVE',
      ].filter(Boolean);
      const modes = priced ? mine.filter((m) => priced.includes(m)) : mine;

      const fetched = await Promise.all(
        modes.map((m) =>
          getRoute(origin, destination, {
            mode: m,
            departureTime: plan.planned_for,
            transitTypes: googleTransitTypes(travelModes),
          })
        )
      );
      const routeByMode = Object.fromEntries(modes.map((m, i) => [m, fetched[i]]));

      const seconds = Object.fromEntries(
        Object.entries(routeByMode).map(([m, r]) => [m, r?.seconds ?? null])
      );
      const best = pickBestLeg(seconds);
      return {
        userId: p.user_id,
        name: p.name,
        mode: best?.mode || null,
        minutes: best?.seconds != null ? Math.round(best.seconds / 60) : null,
        steps: (best && routeByMode[best.mode]?.steps) || [],
      };
    })
  );

  return { venue: { id: venue.id, name: venue.name }, routes };
}
