// Pull venues from Google Places into the local database.
//   npm run ingest                          small dev area (East Village)
//   npm run ingest -- --area=manhattan --yes
//   npm run ingest -- --spacing=500         grid spacing in meters

import { db } from '../src/db.js';
import { searchNearby } from '../src/services/google.js';
import {
  CATEGORY_GROUPS,
  upsertVenue as upsert,
  toVenueRow as toRow,
  inManhattan,
} from '../src/services/placesIngest.js';

const AREAS = {
  dev: { south: 40.722, north: 40.732, west: -73.992, east: -73.978 },
  manhattan: { south: 40.700, north: 40.882, west: -74.020, east: -73.907 },
};

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const area = AREAS[args.area || 'dev'];
if (!area) throw new Error(`Unknown area "${args.area}". Use: ${Object.keys(AREAS).join(', ')}`);
const spacing = Number(args.spacing) || 400;
const MAX_DEPTH = 3;
const M_PER_DEG = 111320;

let calls = 0;
const seen = new Set();

async function sweep(lat, lng, radius, includedTypes, depth = 0) {
  const places = await searchNearby({ lat, lng, radius, includedTypes });
  calls++;

  const rows = places.filter(inManhattan).map(toRow);
  db.transaction(() => rows.forEach((r) => upsert.run(r)))();
  rows.forEach((r) => seen.add(r.id));

  // 20 results means there are probably more: split into 4 smaller circles.
  if (places.length === 20 && depth < MAX_DEPTH) {
    const off = radius / 2;
    const dLat = off / M_PER_DEG;
    const dLng = off / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
    for (const [sy, sx] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      await sweep(lat + sy * dLat, lng + sx * dLng, radius * 0.71, includedTypes, depth + 1);
    }
  }
}

async function main() {
  const latStep = spacing / M_PER_DEG;
  const lngStep = spacing / (M_PER_DEG * Math.cos((area.south * Math.PI) / 180));
  const points = [];
  for (let lat = area.south; lat <= area.north; lat += latStep) {
    for (let lng = area.west; lng <= area.east; lng += lngStep) points.push([lat, lng]);
  }

  const groups = CATEGORY_GROUPS;
  const baseCalls = points.length * groups.length;
  console.log(`${points.length} grid points x ${groups.length} categories = at least ${baseCalls} Places calls`);
  if (baseCalls > 200 && !args.yes) {
    console.log('That could cost real money. Re-run with --yes to continue.');
    process.exit(1);
  }

  const radius = spacing * 0.75; // covers the gaps between grid points
  for (const [i, [lat, lng]] of points.entries()) {
    for (const types of groups) await sweep(lat, lng, radius, types);
    if ((i + 1) % 10 === 0 || i === points.length - 1) {
      console.log(`${i + 1}/${points.length} points, ${seen.size} venues, ${calls} calls`);
    }
  }
  console.log(`Done. ${seen.size} venues saved.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
