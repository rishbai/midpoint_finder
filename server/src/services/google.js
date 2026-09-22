// Thin wrappers around the Google APIs this app uses.
// Enable in Google Cloud: Places API (New), Geocoding API, Routes API.

function apiKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set in server/.env');
  return key;
}

const PLACE_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.types',
  'places.priceLevel',
  'places.rating',
  'places.userRatingCount',
  'places.reviews', // bumps the call into a pricier SKU; needed for tagging
  'places.regularOpeningHours',
].join(',');

// rankPreference decides which 20 of the matching places Google hands back,
// and the two answers barely overlap. POPULARITY — the default — returns the
// most prominent, which in a tourist district means hotels, Olive Garden and
// Dave & Buster's. DISTANCE returns the closest, which is where the actual
// neighborhood places live. For finding somewhere to meet, the second is
// usually what people mean, so ingest asks for both (see liveIngest.js).
export async function searchNearby({ lat, lng, radius, includedTypes, rankPreference = 'POPULARITY' }) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': PLACE_FIELDS,
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 20, // API max; ingest splits the area when this is hit
      rankPreference,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius },
      },
    }),
  });
  if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.places || [];
}

// Cheap follow-up call for venues ingested before hours were tracked:
// requesting only regularOpeningHours avoids the pricier "reviews" SKU.
export async function placeHours(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': 'regularOpeningHours',
    },
  });
  if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.regularOpeningHours ?? null;
}

export async function geocode(address) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('components', 'country:US'); // anywhere in the US, not tied to one state
  url.searchParams.set('key', apiKey());

  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) {
    const err = new Error(`Couldn't find "${address}". Try a fuller address or cross streets.`);
    err.status = 400;
    throw err;
  }
  const r = data.results[0];
  // Because the search is pinned to country:US, Google answers gibberish with
  // a match on the country itself — "United States", at the geographic center
  // of Colorado. Silently accepting that puts someone 1,500 miles from where
  // they actually are and drags the whole group's midpoint with them, so a
  // match this coarse is a failure, not a location.
  if (r.types?.some((t) => TOO_COARSE_TO_START_FROM.includes(t))) {
    const err = new Error(`"${address}" isn't specific enough. Try a city, neighborhood, or full address.`);
    err.status = 400;
    throw err;
  }
  return {
    input: address,
    address: r.formatted_address,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
  };
}

// A whole country or state is never a usable "where I'm coming from".
const TOO_COARSE_TO_START_FROM = ['country', 'administrative_area_level_1'];

// Below this, walking wins over transit even if transit is a hair faster —
// nobody wants to wait for a train to go six blocks.
const WALK_PREFERENCE_SECONDS = 15 * 60;
// How much slower transit is allowed to be and still beat driving. Someone
// who takes the subway isn't looking to shave four minutes by driving and
// then hunting for parking — but they aren't sitting on a bus for 45 minutes
// to avoid a 12-minute drive either, which is exactly the suburban case.
const TRANSIT_TOLERANCE = 1.25;

// Picks the best of the legs we have times for: `times` maps mode -> seconds,
// where a mode may be missing (never asked for) or null (no route found).
// Shared by ranking (meetup.js) and on-demand route detail (plans.js) so
// "which mode wins" is decided the same way in both.
export function pickBestLeg(times) {
  const options = Object.entries(times || {}).filter(([, s]) => s != null);
  if (!options.length) return null;

  const { WALK: walk, TRANSIT: transit, DRIVE: drive } = times;
  if (walk != null && walk <= WALK_PREFERENCE_SECONDS) return { seconds: walk, mode: 'WALK' };
  if (transit != null && drive != null && transit <= drive * TRANSIT_TOLERANCE) {
    return { seconds: transit, mode: 'TRANSIT' };
  }
  const [mode, seconds] = options.reduce((best, o) => (o[1] < best[1] ? o : best));
  return { seconds, mode };
}

const waypoint = (p) => ({
  waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
});

// Returns matrix[origin][destination] = seconds by the given mode, or null if
// no route. Matrices are capped at 100 elements (origins x destinations).
// departureTime only applies to TRANSIT (walking isn't schedule-dependent).
// transitTypes restricts which kinds of transit count, for someone who'll
// take a bus but not the subway (null = no restriction).
export async function routeMatrix(origins, destinations, mode, departureTime, { transitTypes } = {}) {
  const body = {
    origins: origins.map(waypoint),
    destinations: destinations.map(waypoint),
    travelMode: mode,
  };
  if (mode === 'TRANSIT' && departureTime) body.departureTime = new Date(departureTime).toISOString();
  if (mode === 'TRANSIT' && transitTypes) body.transitPreferences = { allowedTravelModes: transitTypes };

  const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Routes API ${res.status}: ${await res.text()}`);
  const rows = await res.json();

  const matrix = origins.map(() => destinations.map(() => null));
  for (const r of rows) {
    if (r.condition !== 'ROUTE_EXISTS' || !r.duration) continue;
    // index 0 is omitted from the JSON response, hence the ?? 0
    matrix[r.originIndex ?? 0][r.destinationIndex ?? 0] = parseInt(r.duration, 10); // "1234s"
  }
  return matrix;
}

const ROUTE_FIELDS = [
  'routes.duration',
  'routes.legs.steps.travelMode',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.polyline.encodedPolyline',
  'routes.legs.steps.navigationInstruction.instructions',
  'routes.legs.steps.transitDetails.transitLine.nameShort',
  'routes.legs.steps.transitDetails.transitLine.name',
  'routes.legs.steps.transitDetails.transitLine.color',
  'routes.legs.steps.transitDetails.transitLine.vehicle.type',
  'routes.legs.steps.transitDetails.headsign',
  'routes.legs.steps.transitDetails.stopCount',
  'routes.legs.steps.transitDetails.stopDetails.departureStop.name',
  'routes.legs.steps.transitDetails.stopDetails.departureStop.location',
  'routes.legs.steps.transitDetails.stopDetails.arrivalStop.name',
  'routes.legs.steps.transitDetails.stopDetails.arrivalStop.location',
].join(',');

// The step-by-step version of routeMatrix, for one origin/destination pair —
// which specific line/bus to take, how many stops, how long each leg is.
// Used on demand (when someone clicks a venue), not for ranking every candidate.
export async function getRoute(origin, destination, { mode = 'TRANSIT', departureTime, transitTypes } = {}) {
  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: mode,
  };
  if (mode === 'TRANSIT' && departureTime) body.departureTime = new Date(departureTime).toISOString();
  if (mode === 'TRANSIT' && transitTypes) body.transitPreferences = { allowedTravelModes: transitTypes };

  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': ROUTE_FIELDS,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Routes API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) return null;

  const stopLatLng = (stop) =>
    stop?.location?.latLng ? { lat: stop.location.latLng.latitude, lng: stop.location.latLng.longitude } : null;

  const steps = (route.legs?.[0]?.steps || []).map((s) => ({
    mode: s.travelMode,
    seconds: parseInt(s.staticDuration, 10) || 0,
    instruction: s.navigationInstruction?.instructions || null,
    polyline: s.polyline?.encodedPolyline || null,
    transit: s.transitDetails
      ? {
          line: s.transitDetails.transitLine?.nameShort || s.transitDetails.transitLine?.name || null,
          color: s.transitDetails.transitLine?.color || null,
          vehicle: s.transitDetails.transitLine?.vehicle?.type || null, // SUBWAY, BUS, RAIL, ...
          headsign: s.transitDetails.headsign || null,
          stops: s.transitDetails.stopCount ?? null,
          from: s.transitDetails.stopDetails?.departureStop?.name || null,
          to: s.transitDetails.stopDetails?.arrivalStop?.name || null,
          fromLocation: stopLatLng(s.transitDetails.stopDetails?.departureStop),
          toLocation: stopLatLng(s.transitDetails.stopDetails?.arrivalStop),
        }
      : null,
  }));

  return { mode, seconds: parseInt(route.duration, 10) || null, steps };
}
