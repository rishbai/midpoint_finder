import { geocode, routeMatrix, pickBestLeg } from './google.js';
import { searchVenues } from './search.js';
import { ensureCoverage } from './liveIngest.js';
import { latestHappyHourEnd } from '../lib/hours.js';

export const MAX_PEOPLE = 6;
const MATRIX_LIMIT = 100; // Google's cap for transit route matrices
const SEARCH_RADII = [1000, 2000, 4000]; // meters; widen until enough candidates
const MIN_CANDIDATES = 15;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export async function findMeetup({ addresses, filters, departureTime }) {
  const cleaned = (addresses || []).map((a) => String(a).trim()).filter(Boolean);
  if (cleaned.length < 2) throw badRequest('Add at least two starting addresses.');
  if (cleaned.length > MAX_PEOPLE) throw badRequest(`Up to ${MAX_PEOPLE} people for now.`);

  const people = await Promise.all(cleaned.map(geocode));
  const { center, results, note } = await rankVenuesForPeople(people, filters, departureTime);
  return { people, center, results, note };
}

const CLOSE_ENOUGH_METERS = 2000;

// Cheap (local DB, plus a live-ingest sweep if the area's sparse) — no
// Routes API cost. Widens the search radius until there's a decent pool,
// same as before.
async function findCandidates(filters, center) {
  let candidates = searchVenues({ ...filters, lat: center.lat, lng: center.lng, radius: SEARCH_RADII[0], sort: 'best', limit: 200 });
  if (candidates.length < MIN_CANDIDATES) {
    // Pass the cuisine along: a generic sweep won't bring in Indian places
    // for an "indian food" ask, but a targeted one will (see liveIngest.js).
    await ensureCoverage(center, { cuisine: filters.cuisine }).catch((err) =>
      console.warn('Live coverage sweep failed:', err.message)
    );
  }
  for (const radius of SEARCH_RADII) {
    candidates = searchVenues({ ...filters, lat: center.lat, lng: center.lng, radius, sort: 'best', limit: 200 });
    if (candidates.length >= MIN_CANDIDATES) break;
  }
  return candidates;
}

const nearestDistance = (candidates) =>
  candidates.length ? Math.min(...candidates.map((c) => c.distance ?? Infinity)) : Infinity;

// Worth this much detour, in seconds, to get a happy hour that's confirmed
// to still be running when they asked for one that goes late. Enough that a
// confirmed match beats a marginally-closer unknown, small enough that
// fairness still decides — nobody gets sent across town over a badge.
const CONFIRMED_LATE_HH_BONUS = 480;

// Expensive (real Routes API calls) — only ever run once, on whichever
// candidate list wins below.
async function rankCandidates(candidates, people, departureTime, filters = {}) {
  if (!candidates.length) return [];

  // Real travel times from each person to the shortlist — transit (which
  // Google already routes over subway, bus, and rail, whichever combination
  // is fastest) and walking, so someone six blocks away isn't sent to the
  // subway. Two matrix calls instead of one; each still respects Google's
  // 100-element cap independently.
  const shortlistSize = Math.min(25, Math.floor(MATRIX_LIMIT / people.length));
  const shortlist = candidates.slice(0, shortlistSize);
  const [transit, walking] = await Promise.all([
    routeMatrix(people, shortlist, 'TRANSIT', departureTime),
    routeMatrix(people, shortlist, 'WALK'),
  ]);

  // Rank by fairness: longest trip first, then how uneven trips are.
  return shortlist
    .map((venue, d) => {
      const legs = people.map((_, o) => pickBestLeg(transit[o][d], walking[o][d]));
      if (legs.some((l) => l == null)) return null;

      const secs = legs.map((l) => l.seconds);
      const longest = Math.max(...secs);
      const spread = longest - Math.min(...secs);
      // Asking for a happy hour that runs late and then ordering purely by
      // travel time buries the places that actually, verifiably run late
      // under ones whose timing nobody knows. Credit them a bounded detour.
      const end = latestHappyHourEnd(venue.hh_windows);
      const confirmedLate =
        filters.happyHourUntil !== undefined && end != null && end >= filters.happyHourUntil;
      return {
        venue,
        minutes: secs.map((s) => Math.round(s / 60)),
        modes: legs.map((l) => l.mode),
        longestMinutes: Math.round(longest / 60),
        spreadMinutes: Math.round(spread / 60),
        score: longest + 0.5 * spread - (confirmedLate ? CONFIRMED_LATE_HH_BONUS : 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score);
}

// Shared by the anonymous "Meet up" flow (addresses geocoded above) and the
// account-based Plans flow (people already have lat/lng from shared location).
// `people` is [{ lat, lng, ... }], order preserved in the returned minutes arrays.
export async function rankVenuesForPeople(people, filters, departureTime) {
  const center = {
    lat: people.reduce((s, p) => s + p.lat, 0) / people.length,
    lng: people.reduce((s, p) => s + p.lng, 0) / people.length,
  };

  // Try progressively looser variants of the filters until something shows
  // up close to the middle. A narrow ask can rule out every real, nearby
  // option even when the general idea ("a cheap bar") is well served nearby —
  // a specific vibe tag depends on Claude having found that exact thing
  // mentioned in a review (easy to under-match), and a strict price tier can
  // just be rare in one particular neighborhood without meaning "cheap" was
  // wrong, only that the cutoff was one notch too tight for this spot.
  // Each attempt here is a cheap local search, not a Routes API call — only
  // the winning candidate list actually gets real travel times computed.
  const attempts = [{ filters, note: null }];
  if (filters.vibes?.length || filters.dish) {
    const dropped = [filters.vibes?.length ? 'vibe' : null, filters.dish ? 'dish' : null].filter(Boolean).join('/');
    attempts.push({
      filters: { ...filters, vibes: [], dish: undefined },
      note: `Nothing matched every filter exactly, so the ${dropped} filter was dropped — these still match everything else.`,
    });
  }
  if (filters.maxPrice !== undefined && filters.maxPrice < 4) {
    attempts.push({
      filters: { ...filters, vibes: [], dish: undefined, maxPrice: filters.maxPrice + 1 },
      note: 'Nothing cheap enough was close by, so the price cutoff was loosened by one tier.',
    });
  }

  let candidates = [];
  let note = null;
  for (const attempt of attempts) {
    const found = await findCandidates(attempt.filters, center);
    if (!found.length) continue;
    candidates = found;
    note = attempt.note;
    if (nearestDistance(found) <= CLOSE_ENOUGH_METERS) break; // good enough, stop relaxing
  }
  if (!candidates.length) return { center, results: [] };

  const results = await rankCandidates(candidates, people, departureTime, filters);
  if (!results.length) return { center, results: [] };

  // Even after all that, the honest truth if the closest match is still far:
  // say so, rather than presenting a distant venue as a good "middle."
  const nearest = nearestDistance(candidates);
  if (!note && nearest > CLOSE_ENOUGH_METERS) {
    note = `The closest match is ${(nearest / 1000).toFixed(1)}km from the middle — this area may be thin on options.`;
  }

  return { center, results, note };
}
