// On-demand Places coverage: rather than paying to pre-ingest a whole city
// (or the whole country) up front, fetch venues right around wherever people
// are actually trying to meet, the first time it's needed — then remember
// that cell for a while so a busy neighborhood doesn't get re-fetched (and
// re-billed) on every plan. Works anywhere in the US: there's no city- or
// state-specific restriction here, just wherever the group's center lands.
import { db } from '../db.js';
import { searchNearby } from './google.js';
import { CATEGORY_GROUPS, upsertVenue, toVenueRow, inUS } from './placesIngest.js';
import { CATEGORY_TYPES, VENUE_STYLES } from '../lib/vocab.js';
import { distanceMeters } from './search.js';
import { tagVenues } from './tagging.js';

const CELL_DEGREES = 0.01; // ~1.1km — one cell roughly covers one sweep's useful radius
const CELL_TTL_DAYS = 60; // venues don't turn over fast enough to re-buy a block monthly
const SWEEP_RADIUS = 900; // meters; a single circle per category, no recursive splitting (cost-bounded)
// A cuisine-specific sweep is a much narrower net (one Google type, e.g.
// indian_restaurant), so it can cast wider without hitting the 20-result cap.
const CUISINE_SWEEP_RADIUS = 2500;
const MAX_SWEEP_RADIUS = 15000; // Google's own cap is higher; this is a cost ceiling
// A generic sweep asks for a whole category, so Google's 20-result cap bites
// quickly and a huge circle just returns the 20 most famous places in a
// county. Keep those circles modest even when the search area is large.
const MAX_GENERIC_SWEEP_RADIUS = 4000;

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

const PLACES_PER_CALL = 20; // Google's hard cap on one nearby search
const M_PER_DEG_LAT = 111320;
const MIN_SPLIT_RADIUS = 350; // below this the circles overlap more than they add
// Each entry is one round trip per ranking, paid while someone waits for their
// plan — enough to look properly around the middle, not enough to map a city.
const SPLIT_CALL_BUDGET = 7;
// One circle over a dense neighborhood only ever returns its densest corner,
// so the targeted sweep starts small and splits from there.
const TARGETED_SWEEP_RADIUS = 1500;
// Tagging is one model call per venue, paid while someone waits, so it goes
// to the places most likely to be candidates: the right kind, nearest first.
const TAG_BUDGET = 40;

// The subset of a sweep's haul worth spending a model call on.
function worthTagging(rows, { center, category, style }) {
  const styleTypes = VENUE_STYLES[style];
  const seen = new Set();
  return rows
    .filter((r) => {
      if (!r.reviews || r.reviews === '[]') return false;
      if (seen.has(r.id)) return false; // the same place can come back from several sweeps
      seen.add(r.id);
      if (styleTypes) {
        let types = [];
        try {
          types = JSON.parse(r.types || '[]');
        } catch {
          return false;
        }
        return types.some((t) => styleTypes.includes(t));
      }
      return category ? r.category === category : true;
    })
    .sort((a, b) => distanceMeters(center, a) - distanceMeters(center, b))
    .slice(0, TAG_BUDGET);
}

// Between Cary and Apex, a 900m sweep lands in trees: the restaurants are in
// the two downtowns, 4km either side. Match the sweep to the area the search
// will actually cover, so what comes back is the places people would really
// consider rather than whatever happened to be near the centroid.
const sweepRadius = (base, searchRadius, max) =>
  clamp(searchRadius || base, base, max);

// Bumped when the sweeps themselves change, so areas covered by an older,
// shallower pass get re-swept instead of being trusted for another 30 days.
const SWEEP_VERSION = 'v2';

// The radius is part of the cache key: a narrow sweep that ran earlier
// shouldn't suppress the wider one a spread-out group needs.
const cellKey = (lat, lng) => `${Math.round(lat / CELL_DEGREES)}:${Math.round(lng / CELL_DEGREES)}`;
const scopeKey = (key, radius) => `${key}@${Math.round(radius / 1000)}k.${SWEEP_VERSION}`;

const getCell = db.prepare('SELECT covered_at FROM covered_cells WHERE cell = ?');
const markCell = db.prepare('INSERT OR REPLACE INTO covered_cells (cell, covered_at) VALUES (?, ?)');

function recentlyCovered(key) {
  const row = getCell.get(key);
  return Boolean(row) && Date.now() - new Date(row.covered_at).getTime() < CELL_TTL_DAYS * 86400000;
}

// One sweep is really two calls. Google caps a nearby search at 20 results and
// picks which 20 by rankPreference, and the two rankings return almost
// disjoint sets: around Times Square, POPULARITY gives hotels and chains while
// DISTANCE gives the bars people actually walk to. Asking only the default way
// is why a Hell's Kitchen pub could be missing entirely while the index still
// believed that block was covered.
async function sweep(center, radius, includedTypes, rankings = ['POPULARITY', 'DISTANCE']) {
  const results = await Promise.all(
    rankings.map((rankPreference) =>
      searchNearby({ lat: center.lat, lng: center.lng, radius, includedTypes, rankPreference })
    )
  );
  const byId = new Map();
  for (const place of results.flat()) if (place?.id) byId.set(place.id, place);

  const rows = [...byId.values()].filter(inUS).map(toVenueRow);
  db.transaction(() => rows.forEach((r) => upsertVenue.run(r)))();
  // Either ranking coming back full means we saw a sample, not everything.
  return { rows, capped: results.some((r) => r.length >= PLACES_PER_CALL) };
}

// Where the ask is specific, one circle isn't enough. Google returns at most
// 20 places per call, and under DISTANCE those are simply the 20 nearest —
// the radius only sets an outer bound, so asking over 4km returns the same
// twenty as asking over 1km. In the West Village that's a couple of blocks'
// worth, which is how bars a ten-minute walk from the middle stayed invisible
// no matter how wide the search got.
//
// So when a circle comes back full, split it into four and look closer, the
// way the batch ingest does (scripts/ingest.js). Bounded by a call budget
// rather than depth: this runs while someone waits for their plan, and the
// point is a decent look around the middle, not a census of Manhattan.
async function splitSweep(center, radius, includedTypes, budget, depth = 0) {
  if (budget.calls >= budget.max) return [];
  budget.calls += 1;

  // Only the first circle asks both ways. Once we're splitting we're already
  // zooming in on a block, and the prominent places there came back in the
  // parent's results — so the children only need the nearest ones.
  const { rows, capped } = await sweep(center, radius, includedTypes, depth === 0 ? ['POPULARITY', 'DISTANCE'] : ['DISTANCE']);
  if (!capped || radius <= MIN_SPLIT_RADIUS) return rows;

  const offset = radius / 2;
  const dLat = offset / M_PER_DEG_LAT;
  const dLng = offset / (M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));
  const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [sy, sx] of corners) {
    if (budget.calls >= budget.max) break;
    rows.push(
      ...(await splitSweep(
        { lat: center.lat + sy * dLat, lng: center.lng + sx * dLng },
        radius * 0.71,
        includedTypes,
        budget,
        depth + 1
      ))
    );
  }
  return rows;
}

// Call when a local search near `center` came back sparse. Fetches fresh
// venues from Google Places for that area and tags the relevant ones right
// away, so vibe/dish filters work on them immediately too, not just the next
// time tag.js runs.
//
// The generic sweep spends its 20 results on a whole category group, so the
// thing actually being looked for can be missing from it entirely — for
// "indian food" it's usually zero Indian restaurants, and for a night out it
// was hotels rather than bars. So whatever narrows the ask (a cuisine, a
// category) gets its own sweep too, cached under its own key so it isn't
// skipped just because the generic sweep already ran for that block.
export async function ensureCoverage(center, { cuisine, category, style, radius } = {}) {
  const key = cellKey(center.lat, center.lng);
  const now = new Date().toISOString();
  const inserted = [];

  // When the ask names a category or kind, the targeted sweep below covers
  // it better than the generic one would, and the other two categories are
  // speculative spend on searches nobody has made yet. They get swept the
  // first time someone actually asks for them here.
  const categoryTypes = VENUE_STYLES[style] || CATEGORY_TYPES[category];
  const generic = sweepRadius(SWEEP_RADIUS, radius, MAX_GENERIC_SWEEP_RADIUS);
  const genericKey = scopeKey(key, generic);
  if (!categoryTypes && !recentlyCovered(genericKey)) {
    for (const includedTypes of CATEGORY_GROUPS) {
      inserted.push(...(await sweep(center, generic, includedTypes)).rows);
    }
    markCell.run(genericKey, now);
  }

  // Asking for a bar and getting the neighborhood's 20 most prominent
  // "food and drink" places is how a block ends up represented by four
  // hotels. A sweep for just this category spends all 20 on what was asked.
  // A style is the narrowest thing asked for, so it gets the closest look:
  // sweeping for `pub` finds pubs, where sweeping the whole bar category
  // spends its twenty results on whatever is most prominent nearby.
  if (categoryTypes) {
    // Starts at a quarter of the search area: about 1.5km for a city group,
    // wider for a spread-out suburban one. Small enough that splitting lands
    // on blocks rather than neighborhoods, since coverage right around the
    // middle is what decides the answer.
    const categoryRadius = clamp(Math.round((radius || 0) / 4) || TARGETED_SWEEP_RADIUS, 1000, MAX_GENERIC_SWEEP_RADIUS);
    const categoryKey = `${scopeKey(key, categoryRadius)}|${style || category}`;
    if (!recentlyCovered(categoryKey)) {
      const budget = { calls: 0, max: SPLIT_CALL_BUDGET };
      inserted.push(...(await splitSweep(center, categoryRadius, categoryTypes, budget)));
      markCell.run(categoryKey, now);
    }
  }

  if (cuisine) {
    const cuisineRadius = sweepRadius(CUISINE_SWEEP_RADIUS, radius, MAX_SWEEP_RADIUS);
    const cuisineKey = `${scopeKey(key, cuisineRadius)}|${cuisine}`;
    if (!recentlyCovered(cuisineKey)) {
      try {
        const budget = { calls: 0, max: SPLIT_CALL_BUDGET };
        inserted.push(...(await splitSweep(center, cuisineRadius, [`${cuisine}_restaurant`], budget)));
        markCell.run(cuisineKey, now);
      } catch (err) {
        // Most likely not a type Google recognizes (cuisines come from the
        // NL parser, which can name one we've never seen). Not fatal — the
        // search just proceeds with whatever's already local.
        console.warn(`Cuisine sweep for "${cuisine}" failed:`, err.message);
      }
    }
  }

  if (!inserted.length) return { fetched: 0, reason: 'recently-covered' };

  // Awaited (not fire-and-forget): if the plan's filters include a vibe or
  // dish, the search that runs right after this needs those tags to already
  // exist, or these brand-new venues would wrongly look like they don't match.
  //
  // But only for places that could actually be shown. Tagging is a model call
  // each, and a sweep brings back every category near the middle — asking for
  // a pub was tagging nearly three hundred venues, most of them cafes and
  // restaurants no bar search can ever return, while the person waited.
  const toTag = worthTagging(inserted, { center, category, style });
  if (toTag.length) {
    await tagVenues(toTag).catch((err) => console.warn('Live-ingest tagging failed:', err.message));
  }

  return { fetched: inserted.length };
}
