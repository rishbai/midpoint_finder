import { geocode, routeMatrix, pickBestLeg } from './google.js';
import { searchVenues, distanceMeters } from './search.js';
import { ensureCoverage } from './liveIngest.js';
import { latestDealEnd } from '../lib/hours.js';
import {
  normalizeTravelModes,
  usesWalk,
  usesDrive,
  usesTransit,
  googleTransitTypes,
  transitSignature,
} from '../lib/travelModes.js';

export const MAX_PEOPLE = 6;
const MATRIX_LIMIT = 100; // Google's cap for transit route matrices
const MIN_CANDIDATES = 15;
const WALK_RANGE_METERS = 2500; // beyond this a walking leg never beats the alternatives

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export async function findMeetup({ addresses, filters, departureTime, travelModes }) {
  const cleaned = (addresses || []).map((a) => String(a).trim()).filter(Boolean);
  if (cleaned.length < 2) throw badRequest('Add at least two starting addresses.');
  if (cleaned.length > MAX_PEOPLE) throw badRequest(`Up to ${MAX_PEOPLE} people for now.`);

  // This flow has no accounts, so there's nobody to hold a preference —
  // one optional list applies to everyone. The Plans flow, where people do
  // have accounts, uses each participant's own (see services/plans.js).
  const shared = normalizeTravelModes(travelModes);
  const geocoded = await Promise.all(cleaned.map(geocode));
  const people = geocoded.map((p) => ({ ...p, travelModes: shared }));

  const ranked = await rankVenuesForPeople(people, filters, departureTime);
  return { people, ...ranked };
}

// How far apart the group already is (meters, roughly the width of the group),
// which is the one signal about a place we get for free, before any API call.
// Two people 2km apart are in a walk-and-subway world; two people 10km apart
// have already told us they expect to travel car distances.
const groupSpread = (people, center) =>
  2 * Math.max(...people.map((p) => distanceMeters(center, p)));

// A group spread over 10km will never find its middle inside a 1km circle —
// and in a suburb, the three places within 1km aren't "the options", they're
// an accident of where the centroid landed. Scale the search to the distances
// these people are evidently already willing to cover. A quarter of the
// spread keeps the result genuinely in the middle rather than next to one
// person; the floor keeps dense-city behavior exactly as it was.
function searchRadii(spread) {
  const base = Math.min(Math.max(1000, Math.round(spread / 4)), 8000);
  return [base, base * 2, base * 4];
}

// "Close enough to the middle to not be worth apologizing for" — also scales,
// since 3km from the center is a non-event when everyone is driving anyway.
const closeEnough = (spread) => Math.max(2000, spread / 4);

// Cheap (local DB, plus a live-ingest sweep if the area's sparse) — no
// Routes API cost. Widens the search radius until there's a decent pool.
async function findCandidates(filters, center, radii) {
  let candidates = searchVenues({ ...filters, lat: center.lat, lng: center.lng, radius: radii[0], sort: 'best', limit: 200 });
  if (candidates.length < MIN_CANDIDATES) {
    // Pass the cuisine along: a generic sweep won't bring in Indian places
    // for an "indian food" ask, but a targeted one will (see liveIngest.js).
    // The radius is the widest we're prepared to search, not the narrowest —
    // ingesting only the inner circle would leave the outer ones empty by
    // construction, which is exactly how a suburb ends up with three options.
    await ensureCoverage(center, {
      cuisine: filters.cuisine,
      category: filters.category,
      style: filters.style,
      radius: radii.at(-1),
    }).catch((err) => console.warn('Live coverage sweep failed:', err.message));
  }
  for (const radius of radii) {
    candidates = searchVenues({ ...filters, lat: center.lat, lng: center.lng, radius, sort: 'best', limit: 200 });
    if (candidates.length >= MIN_CANDIDATES) break;
  }
  return candidates;
}

const nearestDistance = (candidates) =>
  candidates.length ? Math.min(...candidates.map((c) => c.distance ?? Infinity)) : Infinity;

// Worth this much detour, in seconds, for a venue whose discount window is
// confirmed to still be running when someone asked for one that goes late.
// Enough that a confirmed match beats a marginally-closer unknown, small
// enough that fairness still decides — nobody gets sent across town over a badge.
const CONFIRMED_LATE_HH_BONUS = 480;

// Everyone who shares a set of acceptable transit types can ride along on one
// matrix call, so a group that all takes anything still costs one request —
// only a group that genuinely disagrees pays for the disagreement.
function transitGroups(people) {
  const groups = new Map();
  people.forEach((person, index) => {
    if (!usesTransit(person.travelModes)) return;
    const key = transitSignature(person.travelModes);
    if (!groups.has(key)) groups.set(key, { indices: [], types: googleTransitTypes(person.travelModes) });
    groups.get(key).indices.push(index);
  });
  return [...groups.values()];
}

const indicesWhere = (people, test) =>
  people.flatMap((p, i) => (test(p.travelModes) ? [i] : []));

// Fetches travel times as `times[person] = { WALK, TRANSIT, DRIVE }`, each an
// array over the shortlist or null where that person doesn't use that mode.
// Only the modes people actually accept are ever requested: nobody pays for a
// driving matrix on behalf of a friend who doesn't drive.
async function travelTimes(people, shortlist, departureTime, { drivers }) {
  const times = people.map(() => ({ WALK: null, TRANSIT: null, DRIVE: null }));
  const pick = (indices) => indices.map((i) => people[i]);
  const scatter = (indices, mode) => (matrix) =>
    indices.forEach((person, row) => {
      times[person][mode] = matrix[row];
    });

  const jobs = [];
  // Walking is only ever the answer within a couple of kilometers, and a
  // matrix is billed per person per venue, so pricing a walk from Jersey
  // City to twenty-five Manhattan bars buys twenty-five numbers that can't
  // win. Anyone with no venue in range skips the walking matrix entirely;
  // their transit or driving legs are untouched.
  const walkers = indicesWhere(people, usesWalk).filter((i) =>
    shortlist.some((v) => distanceMeters(people[i], v) <= WALK_RANGE_METERS)
  );
  if (walkers.length) {
    jobs.push(routeMatrix(pick(walkers), shortlist, 'WALK').then(scatter(walkers, 'WALK')));
  }
  for (const { indices, types } of transitGroups(people)) {
    jobs.push(
      routeMatrix(pick(indices), shortlist, 'TRANSIT', departureTime, { transitTypes: types })
        .then(scatter(indices, 'TRANSIT'))
    );
  }
  if (drivers?.length) jobs.push(fillDriving(times, people, shortlist, departureTime, drivers));
  await Promise.all(jobs);
  return times;
}

// Adds driving times in place, for the given people only — used both up front
// and on the fallback path, so falling back costs one call rather than
// re-pricing the walking and transit matrices we already have.
async function fillDriving(times, people, shortlist, departureTime, drivers) {
  const matrix = await routeMatrix(drivers.map((i) => people[i]), shortlist, 'DRIVE', departureTime);
  drivers.forEach((person, row) => {
    times[person].DRIVE = matrix[row];
  });
}

// Rank by fairness: longest trip first, then how uneven trips are. `times` is
// per person (they don't all have the same modes available); a venue someone
// can't reach by any mode they'd accept is dropped rather than shown with a
// blank — an unreachable venue isn't a fair middle for that person.
function scoreShortlist(shortlist, people, times, filters) {
  return shortlist
    .map((venue, d) => {
      const legs = people.map((_, o) =>
        pickBestLeg({
          TRANSIT: times[o].TRANSIT?.[d] ?? null,
          WALK: times[o].WALK?.[d] ?? null,
          DRIVE: times[o].DRIVE?.[d] ?? null,
        })
      );
      if (legs.some((l) => l == null)) return null;

      const secs = legs.map((l) => l.seconds);
      const longest = Math.max(...secs);
      const spread = longest - Math.min(...secs);
      // Asking for a deal that runs late and then ordering purely by travel
      // time buries the places that actually, verifiably run late under ones
      // whose timing nobody knows. Credit them a bounded detour.
      const end = latestDealEnd(venue.hh_windows);
      const confirmedLate =
        filters.dealsUntil !== undefined && end != null && end >= filters.dealsUntil;
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

// Above this, an "everyone meets in the middle" trip stops reading as a
// meetup and starts reading as a commute — the cue that transit isn't really
// how this area gets around.
export const LONG_TRIP_MINUTES = 30;

// Did transit actually serve this place? Either it couldn't route to some of
// the shortlist at all, or the best it managed is a slog. Both are the same
// finding: people here drive.
function transitFellShort(scored, shortlist) {
  if (scored.length < shortlist.length) return true;
  return Math.min(...scored.map((s) => s.longestMinutes)) > LONG_TRIP_MINUTES;
}

// Which modes ended up with real numbers, for the step-by-step view to reuse.
const modesPriced = (times) =>
  ['WALK', 'TRANSIT', 'DRIVE'].filter((m) => times.some((t) => t[m]));

// Expensive (real Routes API calls) — only ever run once, on whichever
// candidate list wins below.
async function rankCandidates(candidates, people, departureTime, filters = {}) {
  if (!candidates.length) return { results: [], modesUsed: [] };

  // Real travel times from each person to the shortlist, in the modes that
  // person actually accepts. Each call respects Google's 100-element cap
  // independently.
  const shortlistSize = Math.min(25, Math.floor(MATRIX_LIMIT / people.length));
  const shortlist = candidates.slice(0, shortlistSize);

  const drivers = indicesWhere(people, usesDrive);
  // Someone who drives and takes no transit has no other way to be counted,
  // so they need driving times up front or every venue looks unreachable for
  // them and the whole plan comes back empty.
  const strandedWithoutDriving = people.some((p) => usesDrive(p.travelModes) && !usesTransit(p.travelModes));

  const times = await travelTimes(people, shortlist, departureTime, {
    drivers: strandedWithoutDriving ? drivers : [],
  });
  let results = scoreShortlist(shortlist, people, times, filters);

  // Transit-shaped answers in a car-shaped place. Only now — after transit
  // has demonstrably come up short — do we price driving for the people who
  // drive, so a city plan never reaches this branch and costs what it always
  // did. People who don't drive are untouched: they keep their transit times
  // and still have to be able to get there for a venue to rank.
  if (!strandedWithoutDriving && drivers.length && transitFellShort(results, shortlist)) {
    await fillDriving(times, people, shortlist, departureTime, drivers);
    results = scoreShortlist(shortlist, people, times, filters);
  }

  return { results, modesUsed: modesPriced(times) };
}

// Shared by the anonymous "Meet up" flow (addresses geocoded above) and the
// account-based Plans flow (people already have lat/lng from shared location).
// `people` is [{ lat, lng, ... }], order preserved in the returned minutes arrays.
export async function rankVenuesForPeople(rawPeople, filters, departureTime) {
  // Each person brings their own travel modes; anyone without a stored
  // preference gets the permissive default rather than being left out.
  const people = rawPeople.map((p) => ({ ...p, travelModes: normalizeTravelModes(p.travelModes) }));
  const center = {
    lat: people.reduce((s, p) => s + p.lat, 0) / people.length,
    lng: people.reduce((s, p) => s + p.lng, 0) / people.length,
  };
  const spread = groupSpread(people, center);
  const radii = searchRadii(spread);

  // Try progressively looser variants of the filters until something shows
  // up close to the middle. A narrow ask can rule out every real, nearby
  // option even when the general idea ("somewhere cheap") is well served nearby —
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
      note: `Nothing matched every filter exactly, so the ${dropped} filter was dropped. These still match everything else.`,
    });
  }
  if (filters.maxPrice !== undefined && filters.maxPrice < 4) {
    attempts.push({
      filters: { ...filters, vibes: [], dish: undefined, maxPrice: filters.maxPrice + 1 },
      note: 'Nothing cheap enough was close by, so the price cutoff was loosened by one tier.',
    });
  }
  // Style goes last, because it's usually the most specific thing someone
  // said out loud — "a pub" is a clearer instruction than any vibe tag — and
  // widening to every kind of bar should be the final resort, not the first.
  if (filters.style) {
    attempts.push({
      filters: { ...filters, style: undefined, vibes: [], dish: undefined },
      note: `No ${filters.style.replace('_', ' ')} nearby matched, so these are other bars in the middle instead.`,
    });
  }

  const closeEnoughMeters = closeEnough(spread);
  let candidates = [];
  let note = null;
  for (const attempt of attempts) {
    const found = await findCandidates(attempt.filters, center, radii);
    if (!found.length) continue;
    candidates = found;
    note = attempt.note;
    if (nearestDistance(found) <= closeEnoughMeters) break; // good enough, stop relaxing
  }
  if (!candidates.length) return { center, results: [] };

  const { results, modesUsed } = await rankCandidates(candidates, people, departureTime, filters);
  if (!results.length) return { center, results: [] };

  // Even after all that, the honest truth if the closest match is still far:
  // say so, rather than presenting a distant venue as a good "middle."
  const nearest = nearestDistance(candidates);
  if (!note && nearest > closeEnoughMeters) {
    note = `The closest match is ${(nearest / 1000).toFixed(1)}km from the middle. This area may be thin on options.`;
  }
  // Say when driving got switched on by itself, so nobody wonders why the
  // times suddenly assume a car. Only the people who drive are affected.
  const switchedToDriving =
    modesUsed.includes('DRIVE') && people.some((p) => usesTransit(p.travelModes));
  if (!note && switchedToDriving) {
    note = 'Transit is thin around here, so anyone who drives is routed by car.';
  }

  return { center, results, note, modesUsed };
}
