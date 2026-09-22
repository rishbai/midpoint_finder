// Google place types grouped into the categories the app shows.
export const CATEGORY_TYPES = {
  restaurant: ['restaurant'],
  cafe: ['cafe', 'coffee_shop', 'bakery'],
  // Google files a place under a specific type, not the generic one: an
  // Irish pub is `irish_pub`, a dive with food is `bar_and_grill`. Listing
  // only the generic three both mis-filed those places and left them out of
  // the sweeps that go looking for somewhere to get a drink.
  bar: [
    'bar',
    'pub',
    'wine_bar',
    'cocktail_bar',
    'sports_bar',
    'irish_pub',
    'bar_and_grill',
    'beer_garden',
    'brewery',
  ],
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
  // What reviewers say it costs, which is a different question from Google's
  // price tier: that tier is missing for roughly a quarter of bars and calls
  // almost every Manhattan one "moderate", so it can't answer "is this cheap".
  'good_value',
];

export const PRICE_LEVELS = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

// Most of Google's food types end in _restaurant, but a handful of common
// ones don't, and without them a steakhouse falls through to whatever else
// it's tagged as — usually its bar.
const OTHER_FOOD_TYPES = [
  'restaurant',
  'steak_house',
  'sandwich_shop',
  'deli',
  'diner',
  'food_court',
  'meal_takeaway',
  'meal_delivery',
];
const isRestaurantType = (t) => OTHER_FOOD_TYPES.includes(t) || t.endsWith('_restaurant');

export function categorize(primaryType, types = []) {
  // Google's own answer to "what is this place" wins when we recognize it, so
  // a restaurant with a bar in it stays a restaurant.
  if (primaryType) {
    if (CATEGORY_TYPES.bar.includes(primaryType)) return 'bar';
    if (CATEGORY_TYPES.cafe.includes(primaryType)) return 'cafe';
    if (isRestaurantType(primaryType)) return 'restaurant';
  }
  // Otherwise the whole type list, bars first — and deliberately not in list
  // order. Google tags an Irish pub as irish_pub, pub, bar AND
  // irish_restaurant; walking the list in order hit the restaurant tag first
  // and filed a pub as a restaurant, where no search for a drink could reach it.
  if (types.some((t) => CATEGORY_TYPES.bar.includes(t))) return 'bar';
  if (types.some((t) => CATEGORY_TYPES.cafe.includes(t))) return 'cafe';
  if (types.some(isRestaurantType)) return 'restaurant';
  return 'other';
}

const GENERIC = new Set(['restaurant', 'fast_food_restaurant']);

export function cuisineOf(primaryType, types = []) {
  const t = [primaryType, ...types].find(
    (x) => x && x.endsWith('_restaurant') && !GENERIC.has(x)
  );
  return t ? t.replace(/_restaurant$/, '') : null;
}
