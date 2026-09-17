// Shared by scripts/ingest.js (deliberate, full-area sweeps) and
// services/liveIngest.js (on-demand, one cell at a time) — the actual
// Places-result-to-venues-row mapping and upsert, so both stay consistent.
import { db } from '../db.js';
import { CATEGORY_TYPES, PRICE_LEVELS, categorize, cuisineOf } from '../lib/vocab.js';

export const upsertVenue = db.prepare(`
  INSERT INTO venues (id, name, address, lat, lng, category, cuisine, price_level,
                      rating, rating_count, types, reviews, hours, updated_at)
  VALUES (@id, @name, @address, @lat, @lng, @category, @cuisine, @price_level,
          @rating, @rating_count, @types, @reviews, @hours, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, address = excluded.address, lat = excluded.lat, lng = excluded.lng,
    category = excluded.category, cuisine = excluded.cuisine, price_level = excluded.price_level,
    rating = excluded.rating, rating_count = excluded.rating_count, types = excluded.types,
    reviews = excluded.reviews, hours = excluded.hours, updated_at = excluded.updated_at
`);

export function toVenueRow(p) {
  return {
    id: p.id,
    name: p.displayName?.text ?? 'Unknown',
    address: p.formattedAddress ?? null,
    lat: p.location.latitude,
    lng: p.location.longitude,
    category: categorize(p.primaryType, p.types),
    cuisine: cuisineOf(p.primaryType, p.types),
    price_level: PRICE_LEVELS[p.priceLevel] ?? null,
    rating: p.rating ?? null,
    rating_count: p.userRatingCount ?? 0,
    types: JSON.stringify(p.types ?? []),
    reviews: JSON.stringify((p.reviews ?? []).map((r) => r.text?.text).filter(Boolean)),
    hours: p.regularOpeningHours ? JSON.stringify(p.regularOpeningHours) : null,
    updated_at: new Date().toISOString(),
  };
}

// The bounding box (and a plain radius search) spills into NJ, Brooklyn,
// Queens, and the Bronx — this app is Manhattan-only by design.
export const inManhattan = (p) => p.formattedAddress?.includes('New York, NY');

export const CATEGORY_GROUPS = Object.values(CATEGORY_TYPES);
