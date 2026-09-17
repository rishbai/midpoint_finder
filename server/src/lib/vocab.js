// Google place types grouped into the categories the app shows.
export const CATEGORY_TYPES = {
  restaurant: ['restaurant'],
  cafe: ['cafe', 'coffee_shop', 'bakery'],
  bar: ['bar', 'wine_bar', 'pub'],
};

// Fixed list so the tagger can't invent new vibes.
export const VIBES = [
  'date_night',
  'work_friendly',
  'good_for_groups',
  'good_for_solo',
  'quiet',
  'lively',
  'cozy',
  'casual',
  'upscale',
  'late_night',
  'outdoor_seating',
  'happy_hour',
];

export const PRICE_LEVELS = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export function categorize(primaryType, types = []) {
  const all = [primaryType, ...types].filter(Boolean);
  // primary type is checked first, so a "bar" that also serves food stays a bar
  for (const t of all) {
    if (CATEGORY_TYPES.bar.includes(t)) return 'bar';
    if (CATEGORY_TYPES.cafe.includes(t)) return 'cafe';
    if (t === 'restaurant' || t.endsWith('_restaurant')) return 'restaurant';
  }
  return 'other';
}

const GENERIC = new Set(['restaurant', 'fast_food_restaurant']);

export function cuisineOf(primaryType, types = []) {
  const t = [primaryType, ...types].find(
    (x) => x && x.endsWith('_restaurant') && !GENERIC.has(x)
  );
  return t ? t.replace(/_restaurant$/, '') : null;
}
