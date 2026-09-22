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

const MODE_ICONS = { WALK: '🚶', TRANSIT: '🚇', DRIVE: '🚗' };
export const modeIcon = (mode) => MODE_ICONS[mode] || '';

// How one person is willing to travel for one plan
// (plan_participants.travel_modes on the server). Everyone starts with all
// four; you turn off what you won't use, for that plan only.
export const TRAVEL_MODES = [
  { value: 'walk', label: 'Walking', icon: '🚶' },
  { value: 'subway', label: 'Subway & train', icon: '🚇' },
  { value: 'bus', label: 'Bus', icon: '🚌' },
  { value: 'drive', label: 'Driving', icon: '🚗' },
];
export const ALL_TRAVEL_MODES = TRAVEL_MODES.map((m) => m.value);

// "🚶 🚇" — a compact read of how someone gets around, for a participant row.
export const travelModeIcons = (modes) =>
  (modes || []).map((v) => TRAVEL_MODES.find((m) => m.value === v)?.icon).filter(Boolean).join(' ');

// Only worth spelling out when it isn't just "anything" — otherwise it's noise.
export function travelModeSummary(modes) {
  if (!modes?.length || modes.length === ALL_TRAVEL_MODES.length) return null;
  return TRAVEL_MODES.filter((m) => modes.includes(m.value)).map((m) => m.label).join(', ');
}

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
// morning after (see venues.hh_windows), so 1470 reads as "12:30am".
function clockTime(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}${min ? `:${String(min).padStart(2, '0')}` : ''}${h24 < 12 ? 'am' : 'pm'}`;
}

// "Deals 4–7pm, 10pm–midnight" — every window reviews actually stated, since
// the late one is often a separate late-night offer (venues.hh_windows).
export function dealLabel(windowsJson) {
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
  return `Deals ${windows.map(span).join(', ')}`;
}

// One-line human summary of an active filters object, e.g. "cafe · $$ · 4.5+
// · cozy · open now" — used wherever we show what's currently applied.
export function summarizeFilters(filters) {
  return [
    // The style already says "bar", so showing both reads as a stutter.
    filters.style ? filters.style.replace('_', ' ') : filters.category,
    filters.cuisine,
    filters.minPrice || filters.maxPrice ? price(filters.maxPrice || filters.minPrice) : null,
    filters.minRating ? `${filters.minRating}+ rating` : null,
    filters.vibes?.length ? filters.vibes.map(label).join(', ') : null,
    filters.dish,
    filters.openNow ? 'open now' : filters.openMinutes != null ? 'open at the right time' : null,
  ].filter(Boolean).join(' · ');
}
