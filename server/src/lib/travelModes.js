// How one person is willing to get around. This is a property of the person,
// not of the plan: in the same group, one friend walks everywhere, one won't
// go near the subway but will take a bus, and one drives. Ranking honors each
// person's own list, so the "fair middle" is fair by their standards.
//
// Tokens are ours, not Google's, because the useful distinction for a person
// ("I'll take a bus but not the subway") doesn't line up one-to-one with
// Google's travelMode. See googleTransitTypes below for the translation.
export const TRAVEL_MODES = ['walk', 'subway', 'bus', 'drive'];

// Everything, for a new account. Deliberately permissive: the bias rules in
// pickBestLeg already prefer a short walk over anything and transit over
// driving when they're close, so a default of "whatever works" behaves like
// a transit-first app in a city and still finds real answers in a suburb.
// Someone who won't take the subway turns it off; nobody has to opt in to
// their own city working.
export const DEFAULT_TRAVEL_MODES = [...TRAVEL_MODES];

// Google splits rail into four names; to a person it's all "the subway/train".
const RAIL_TYPES = ['SUBWAY', 'TRAIN', 'LIGHT_RAIL', 'RAIL'];

// Accepts a JSON string (as stored) or an array (as posted). Anything
// unrecognized, or a selection of nothing, falls back to the default rather
// than leaving someone with no way to get anywhere.
export function normalizeTravelModes(value) {
  let list = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      list = null;
    }
  }
  if (!Array.isArray(list)) return [...DEFAULT_TRAVEL_MODES];
  const cleaned = TRAVEL_MODES.filter((m) => list.includes(m));
  return cleaned.length ? cleaned : [...DEFAULT_TRAVEL_MODES];
}

export const usesWalk = (modes) => modes.includes('walk');
export const usesDrive = (modes) => modes.includes('drive');
export const usesTransit = (modes) => modes.includes('subway') || modes.includes('bus');

// The `transitPreferences.allowedTravelModes` to send Google, or null for no
// restriction — which is what you want when someone takes both, since it lets
// Google combine a bus and a train into one trip.
export function googleTransitTypes(modes) {
  const rail = modes.includes('subway');
  const bus = modes.includes('bus');
  if (rail && bus) return null;
  if (rail) return RAIL_TYPES;
  if (bus) return ['BUS'];
  return null;
}

// Two people who accept the same kinds of transit can share a single matrix
// call, so a group that all takes anything still costs exactly one request.
export const transitSignature = (modes) =>
  `${modes.includes('subway') ? 'rail' : ''}|${modes.includes('bus') ? 'bus' : ''}`;
