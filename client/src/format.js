export const label = (s) => (s ? s.replaceAll('_', ' ') : '');

export const price = (level) => (level ? '$'.repeat(level) : '');

// Used to label each person in a plan/meetup (A, B, C...) — paired with the
// .avatar[data-i] color rotation in styles.css.
export const personLetter = (i) => String.fromCharCode(65 + i);

// Google's transit vehicle types, collapsed to plain words for display.
const VEHICLES = {
  SUBWAY: 'subway',
  METRO_RAIL: 'subway',
  BUS: 'bus',
  RAIL: 'train',
  HEAVY_RAIL: 'train',
  COMMUTER_TRAIN: 'train',
  HIGH_SPEED_TRAIN: 'train',
  LONG_DISTANCE_TRAIN: 'train',
  TRAM: 'tram',
  FERRY: 'ferry',
  MONORAIL: 'monorail',
};
export const vehicleLabel = (vehicle) => VEHICLES[vehicle] || 'transit';

export const modeIcon = (mode) => (mode === 'WALK' ? '🚶' : mode === 'TRANSIT' ? '🚇' : '');

// "Sun, Sep 21 · 7:37 PM" — short enough for a card, clear enough on its own.
export function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

export const initial = (name) => (name ? name.trim()[0].toUpperCase() : '?');

// Minutes since midnight -> "7pm" / "10:30pm". Values past 1440 are the
// morning after (see venues.hh_end), so 1470 reads as "12:30am".
function clockTime(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}${min ? `:${String(min).padStart(2, '0')}` : ''}${h24 < 12 ? 'am' : 'pm'}`;
}

// "Happy hour 4–7pm, 10pm–midnight" — every window reviews actually stated,
// since the late one is often a separate late-night deal (venues.hh_windows).
export function happyHourLabel(windowsJson) {
  if (!windowsJson) return null;
  let windows;
  try {
    windows = typeof windowsJson === 'string' ? JSON.parse(windowsJson) : windowsJson;
  } catch {
    return null;
  }
  if (!Array.isArray(windows) || !windows.length) return null;

  const span = ({ start, end }) => {
    const until = end % 1440 === 0 ? 'midnight' : clockTime(end);
    return start == null ? `until ${until}` : `${clockTime(start)}–${until}`;
  };
  return `Happy hour ${windows.map(span).join(', ')}`;
}

// One-line human summary of an active filters object, e.g. "bar · $$ · 4.5+
// · happy hour · open now" — used wherever we show what's currently applied.
export function summarizeFilters(filters) {
  return [
    filters.category,
    filters.cuisine,
    filters.minPrice || filters.maxPrice ? price(filters.maxPrice || filters.minPrice) : null,
    filters.minRating ? `${filters.minRating}+ rating` : null,
    filters.vibes?.length ? filters.vibes.map(label).join(', ') : null,
    filters.dish,
    filters.openNow ? 'open now' : filters.openMinutes != null ? 'open at the right time' : null,
  ].filter(Boolean).join(' · ');
}
