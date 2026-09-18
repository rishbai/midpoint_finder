import { geocode, routeMatrix, pickBestLeg } from './google.js';
import { searchVenues } from './search.js';
import { ensureCoverage } from './liveIngest.js';

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

// Finds candidates near `center` matching `filters`, gets real transit+walk
// times to a shortlist, and ranks by fairness. Returns [] results (not an
// error) when nothing pans out, so the caller can decide whether to relax
// and retry rather than just showing a dead end.
async function searchAndRank(filters, center, people, departureTime) {
  let candidates = searchVenues({ ...filters, lat: center.lat, lng: center.lng, radius: SEARCH_RADII[0], sort: 'best', limit: 200 });
  if (candidates.length < MIN_CANDIDATES) {
    await ensureCoverage(center).catch((err) => console.warn('Live coverage sweep failed:', err.message));
  }
  for (const radius of SEARCH_RADII) {
    candidates = searchVenues({ ...filters, lat: center.lat, lng: center.lng, radius, sort: 'best', limit: 200 });
    if (candidates.length >= MIN_CANDIDATES) break;
  }
  if (!candidates.length) return { candidates, results: [] };

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
  const results = shortlist
    .map((venue, d) => {
      const legs = people.map((_, o) => pickBestLeg(transit[o][d], walking[o][d]));
      if (legs.some((l) => l == null)) return null;

      const secs = legs.map((l) => l.seconds);
      const longest = Math.max(...secs);
      const spread = longest - Math.min(...secs);
      return {
        venue,
        minutes: secs.map((s) => Math.round(s / 60)),
        modes: legs.map((l) => l.mode),
        longestMinutes: Math.round(longest / 60),
        spreadMinutes: Math.round(spread / 60),
        score: longest + 0.5 * spread,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score);

  return { candidates, results };
}

// Shared by the anonymous "Meet up" flow (addresses geocoded above) and the
// account-based Plans flow (people already have lat/lng from shared location).
// `people` is [{ lat, lng, ... }], order preserved in the returned minutes arrays.
export async function rankVenuesForPeople(people, filters, departureTime) {
  const center = {
    lat: people.reduce((s, p) => s + p.lat, 0) / people.length,
    lng: people.reduce((s, p) => s + p.lng, 0) / people.length,
  };

  let { candidates, results } = await searchAndRank(filters, center, people, departureTime);
  let note = null;

  // A narrow ask (especially a specific vibe — it depends on Claude having
  // found that exact thing mentioned in reviews, so it's easy to under-match)
  // can rule out every real, nearby option. Don't just show a dead end when
  // that happens: drop the narrowest parts of the filter and try again,
  // rather than pretending nothing at all fits the general idea.
  if (!results.length && (filters.vibes?.length || filters.dish)) {
    const relaxed = { ...filters, vibes: [], dish: undefined };
    const retry = await searchAndRank(relaxed, center, people, departureTime);
    if (retry.results.length) {
      ({ candidates, results } = retry);
      const dropped = [filters.vibes?.length ? 'vibe' : null, filters.dish ? 'dish' : null].filter(Boolean).join('/');
      note = `Nothing matched every filter exactly, so the ${dropped} filter was dropped — these still match everything else.`;
    }
  }

  if (!results.length) return { center, results: [] };

  // Even after a live sweep (and a relaxed retry), the honest truth if the
  // closest match is still far: say so, rather than presenting a distant
  // venue as a good "middle."
  const nearest = Math.min(...candidates.map((c) => c.distance ?? Infinity));
  if (!note && nearest > 2000) {
    note = `The closest match is ${(nearest / 1000).toFixed(1)}km from the middle — this area may be thin on options.`;
  }

  return { center, results, note };
}
