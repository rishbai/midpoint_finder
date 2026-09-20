// On-demand Places coverage: rather than paying to pre-ingest a whole city
// (or the whole country) up front, fetch venues right around wherever people
// are actually trying to meet, the first time it's needed — then remember
// that cell for a while so a busy neighborhood doesn't get re-fetched (and
// re-billed) on every plan. Works anywhere in the US: there's no city- or
// state-specific restriction here, just wherever the group's center lands.
import { db } from '../db.js';
import { searchNearby } from './google.js';
import { CATEGORY_GROUPS, upsertVenue, toVenueRow, inUS } from './placesIngest.js';
import { tagVenues } from './tagging.js';

const CELL_DEGREES = 0.01; // ~1.1km — one cell roughly covers one sweep's useful radius
const CELL_TTL_DAYS = 30;
const SWEEP_RADIUS = 900; // meters; a single circle per category, no recursive splitting (cost-bounded)
// A cuisine-specific sweep is a much narrower net (one Google type, e.g.
// indian_restaurant), so it can cast wider without hitting the 20-result cap.
const CUISINE_SWEEP_RADIUS = 2500;

const cellKey = (lat, lng) => `${Math.round(lat / CELL_DEGREES)}:${Math.round(lng / CELL_DEGREES)}`;

const getCell = db.prepare('SELECT covered_at FROM covered_cells WHERE cell = ?');
const markCell = db.prepare('INSERT OR REPLACE INTO covered_cells (cell, covered_at) VALUES (?, ?)');

function recentlyCovered(key) {
  const row = getCell.get(key);
  return Boolean(row) && Date.now() - new Date(row.covered_at).getTime() < CELL_TTL_DAYS * 86400000;
}

async function sweep(center, radius, includedTypes) {
  const places = await searchNearby({ lat: center.lat, lng: center.lng, radius, includedTypes });
  const rows = places.filter(inUS).map(toVenueRow);
  db.transaction(() => rows.forEach((r) => upsertVenue.run(r)))();
  return rows;
}

// Call when a local search near `center` came back sparse. Fetches fresh
// venues from Google Places for that immediate area (three calls: one per
// category group) and tags the ones with reviews right away, so vibe/dish
// filters work on them immediately too — not just the next time tag.js runs.
//
// The generic sweep returns Google's 20 most prominent places per category —
// for "indian food" that's usually zero Indian restaurants. So when a
// cuisine is asked for, also do a targeted sweep for that one Google type
// (indian_restaurant, italian_restaurant, ...), cached separately per
// cuisine so it isn't skipped just because the generic sweep already ran.
export async function ensureCoverage(center, { cuisine } = {}) {
  const key = cellKey(center.lat, center.lng);
  const now = new Date().toISOString();
  const inserted = [];

  if (!recentlyCovered(key)) {
    for (const includedTypes of CATEGORY_GROUPS) inserted.push(...(await sweep(center, SWEEP_RADIUS, includedTypes)));
    markCell.run(key, now);
  }

  if (cuisine) {
    const cuisineKey = `${key}|${cuisine}`;
    if (!recentlyCovered(cuisineKey)) {
      try {
        inserted.push(...(await sweep(center, CUISINE_SWEEP_RADIUS, [`${cuisine}_restaurant`])));
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
  const withReviews = inserted.filter((r) => r.reviews && r.reviews !== '[]');
  if (withReviews.length) {
    await tagVenues(withReviews).catch((err) => console.warn('Live-ingest tagging failed:', err.message));
  }

  return { fetched: inserted.length };
}
