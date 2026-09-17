// One-time fill-in for venues ingested before we tracked opening hours.
// Uses Place Details with a hours-only field mask, which is cheaper than a
// full re-ingest (no reviews SKU).
//   npm run backfill-hours
//   npm run backfill-hours -- --limit=50

import { db } from '../src/db.js';
import { placeHours } from '../src/services/google.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const LIMIT = Number(args.limit) || 2000;
const CONCURRENCY = 5;

const venues = db.prepare('SELECT id FROM venues WHERE hours IS NULL LIMIT ?').all(LIMIT);
const setHours = db.prepare('UPDATE venues SET hours = ? WHERE id = ?');

async function main() {
  console.log(`Backfilling hours for ${venues.length} venues`);
  let done = 0;
  let failed = 0;
  for (let i = 0; i < venues.length; i += CONCURRENCY) {
    const batch = venues.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (v) => setHours.run(JSON.stringify(await placeHours(v.id)), v.id))
    );
    results.forEach((r) => (r.status === 'fulfilled' ? done++ : failed++));
    console.log(`${done + failed}/${venues.length} (${failed} failed)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
