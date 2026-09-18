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

const cellKey = (lat, lng) => `${Math.round(lat / CELL_DEGREES)}:${Math.round(lng / CELL_DEGREES)}`;

const getCell = db.prepare('SELECT covered_at FROM covered_cells WHERE cell = ?');
const markCell = db.prepare('INSERT OR REPLACE INTO covered_cells (cell, covered_at) VALUES (?, ?)');

// Call when a local search near `center` came back sparse. Fetches fresh
// venues from Google Places for that immediate area (three calls: one per
// category group) and tags the ones with reviews right away, so vibe/dish
// filters work on them immediately too — not just the next time tag.js runs.
export async function ensureCoverage(center) {
  const key = cellKey(center.lat, center.lng);
  const cached = getCell.get(key);
  if (cached && Date.now() - new Date(cached.covered_at).getTime() < CELL_TTL_DAYS * 86400000) {
    return { fetched: 0, reason: 'recently-covered' };
  }

  const inserted = [];
  for (const includedTypes of CATEGORY_GROUPS) {
    const places = await searchNearby({ lat: center.lat, lng: center.lng, radius: SWEEP_RADIUS, includedTypes });
    const rows = places.filter(inUS).map(toVenueRow);
    db.transaction(() => rows.forEach((r) => upsertVenue.run(r)))();
    inserted.push(...rows);
  }
  markCell.run(key, new Date().toISOString());

  // Awaited (not fire-and-forget): if the plan's filters include a vibe or
  // dish, the search that runs right after this needs those tags to already
  // exist, or these brand-new venues would wrongly look like they don't match.
  const withReviews = inserted.filter((r) => r.reviews && r.reviews !== '[]');
  if (withReviews.length) {
    await tagVenues(withReviews).catch((err) => console.warn('Live-ingest tagging failed:', err.message));
  }

  return { fetched: inserted.length };
}
