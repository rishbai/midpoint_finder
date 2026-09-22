import { db } from '../db.js';
import { isOpenAt, dayAndMinutesAt, latestDealEnd } from '../lib/hours.js';

const M_PER_DEG_LAT = 111320;

export function distanceMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
const list = (v) =>
  Array.isArray(v) ? v.filter(Boolean) : v ? String(v).split(',').filter(Boolean) : [];

// Accepts query-string values or a JSON body and returns clean filters.
export function normalizeFilters(raw = {}) {
  return {
    category: raw.category || undefined,
    cuisine: raw.cuisine || undefined,
    minPrice: num(raw.minPrice),
    maxPrice: num(raw.maxPrice),
    minRating: num(raw.minRating),
    vibes: list(raw.vibes),
    dish: raw.dish ? String(raw.dish).trim() : undefined,
    q: raw.q ? String(raw.q).trim() : undefined,
    lat: num(raw.lat),
    lng: num(raw.lng),
    radius: num(raw.radius),
    sort: raw.sort === 'distance' ? 'distance' : 'best',
    limit: Math.min(num(raw.limit) || 50, 200),
    // "open past 7pm [on Friday]": a specific day (0=Sun..6=Sat) + minute-of-day,
    // both required together. openNow is the simpler "open right now" case.
    openDay: raw.openDay !== undefined && raw.openDay !== '' ? Number(raw.openDay) : undefined,
    openMinutes: num(raw.openMinutes),
    openNow: raw.openNow === true || raw.openNow === 'true',
    // "deals that go late": the discount must still be on at this
    // minute-of-day, which is a different thing from the venue being open
    // then. Ranks rather than filters — see searchVenues.
    // happyHourUntil is the old name for this key, still sitting in the
    // stored filters of plans created before the rename.
    dealsUntil: num(raw.dealsUntil ?? raw.happyHourUntil),
  };
}

// Rating weighted by review count, so 4.9 from 8 reviews
// doesn't beat 4.6 from 2,000.
function qualityScore(v) {
  if (!v.rating) return 0;
  return v.rating * Math.log10((v.rating_count || 0) + 10);
}

export function searchVenues(f) {
  const where = [];
  const p = {};

  if (f.category) { where.push('v.category = @category'); p.category = f.category; }
  if (f.cuisine) { where.push('v.cuisine = @cuisine'); p.cuisine = f.cuisine; }
  if (f.minPrice !== undefined) { where.push('v.price_level >= @minPrice'); p.minPrice = f.minPrice; }
  // An unpriced venue is unknown, not expensive — but `price_level <= 1` is
  // NULL for those rows, so plain SQL silently drops every one of them. Around
  // Times Square that was a quarter of the bars, the dive-bar end in
  // particular, thrown away before ranking by the very filter meant to find
  // them. Unknown prices stay in and are judged on everything else.
  if (f.maxPrice !== undefined) {
    where.push('(v.price_level <= @maxPrice OR v.price_level IS NULL)');
    p.maxPrice = f.maxPrice;
  }
  if (f.minRating !== undefined) { where.push('v.rating >= @minRating'); p.minRating = f.minRating; }
  if (f.q) { where.push('v.name LIKE @q'); p.q = `%${f.q}%`; }
  if (f.dish) {
    where.push(`EXISTS (SELECT 1 FROM venue_tags t
      WHERE t.venue_id = v.id AND t.kind = 'dish' AND t.tag LIKE @dish)`);
    p.dish = `%${f.dish.toLowerCase()}%`;
  }
  f.vibes.forEach((vibe, i) => {
    where.push(`EXISTS (SELECT 1 FROM venue_tags t
      WHERE t.venue_id = v.id AND t.kind = 'vibe' AND t.tag = @vibe${i})`);
    p[`vibe${i}`] = vibe;
  });

  const near = f.lat !== undefined && f.lng !== undefined;
  const radius = f.radius || 1000;
  if (near) {
    // cheap bounding box in SQL, exact distance in JS below
    const dLat = radius / M_PER_DEG_LAT;
    const dLng = radius / (M_PER_DEG_LAT * Math.cos((f.lat * Math.PI) / 180));
    where.push('v.lat BETWEEN @latMin AND @latMax AND v.lng BETWEEN @lngMin AND @lngMax');
    Object.assign(p, {
      latMin: f.lat - dLat, latMax: f.lat + dLat,
      lngMin: f.lng - dLng, lngMax: f.lng + dLng,
    });
  }

  const rows = db.prepare(`
    SELECT v.id, v.name, v.address, v.lat, v.lng, v.category, v.cuisine,
           v.price_level, v.rating, v.rating_count, v.hours, v.hh_windows,
           (SELECT group_concat(tag) FROM venue_tags t WHERE t.venue_id = v.id AND t.kind = 'vibe') AS vibes,
           (SELECT group_concat(tag) FROM venue_tags t WHERE t.venue_id = v.id AND t.kind = 'dish') AS dishes
    FROM venues v
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY v.rating_count DESC
    LIMIT 2000
  `).all(p);

  let results = rows.map((r) => ({
    ...r,
    vibes: r.vibes ? r.vibes.split(',') : [],
    dishes: r.dishes ? r.dishes.split(',') : [],
  }));

  if (f.openNow || (f.openDay !== undefined && f.openMinutes !== undefined)) {
    const explicitTarget = f.openDay !== undefined && f.openMinutes !== undefined
      ? { day: f.openDay, minutes: f.openMinutes }
      : null;
    // "Open now" means now in *that venue's* timezone — a place in LA and one
    // in NYC aren't on the same clock, so this is computed per row, not once
    // for the whole batch. An explicit day/time (from NL parsing) is already
    // a fixed point in the week and applies as-is regardless of venue location.
    // Unknown hours can't be confirmed open, so they're excluded rather than guessed at.
    results = results.filter((r) => {
      const target = explicitTarget || dayAndMinutesAt(new Date(), r.lat, r.lng);
      return isOpenAt(r.hours, target) === true;
    });
  }

  if (near) {
    const center = { lat: f.lat, lng: f.lng };
    results = results
      .map((r) => ({ ...r, distance: Math.round(distanceMeters(center, r)) }))
      .filter((r) => r.distance <= radius);
  }

  const byRelevance = f.sort === 'distance' && near
    ? (a, b) => a.distance - b.distance
    : (a, b) => qualityScore(b) - qualityScore(a);

  if (f.dealsUntil !== undefined) {
    // Google publishes no discount hours, so this only exists where a
    // review happened to say it — roughly one venue in six. Ranking rather
    // than filtering keeps the rest visible instead of emptying the page:
    // confirmed-runs-late first, then everything else by the usual order.
    const runsLate = (v) => {
      const end = latestDealEnd(v.hh_windows);
      return end != null && end >= f.dealsUntil ? 1 : 0;
    };
    results.sort((a, b) => runsLate(b) - runsLate(a) || byRelevance(a, b));
  } else {
    results.sort(byRelevance);
  }

  return results.slice(0, f.limit);
}

export function getVenue(id) {
  const v = db.prepare('SELECT * FROM venues WHERE id = ?').get(id);
  if (!v) return null;
  const tags = db.prepare('SELECT kind, tag FROM venue_tags WHERE venue_id = ?').all(id);
  return {
    ...v,
    types: JSON.parse(v.types || '[]'),
    reviews: JSON.parse(v.reviews || '[]'),
    vibes: tags.filter((t) => t.kind === 'vibe').map((t) => t.tag),
    dishes: tags.filter((t) => t.kind === 'dish').map((t) => t.tag),
  };
}

export function listCuisines() {
  return db
    .prepare('SELECT DISTINCT cuisine FROM venues WHERE cuisine IS NOT NULL ORDER BY cuisine')
    .all()
    .map((r) => r.cuisine);
}
