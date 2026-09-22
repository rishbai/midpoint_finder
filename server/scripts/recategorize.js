// Re-derive each venue's category from the Google types already stored on it.
//   npm run recategorize -- --dry
//
// Categories are decided once, at ingest, so a fix to how types are read only
// helps places fetched afterwards — everything already in the database keeps
// whatever it was first filed as. This recomputes them in place. Free: the
// types are already in the row, so there are no API calls.
import { db } from '../src/db.js';
import { categorize } from '../src/lib/vocab.js';

const dry = process.argv.includes('--dry');

const rows = db.prepare('SELECT id, name, category, types FROM venues').all();
const setCategory = db.prepare('UPDATE venues SET category = ? WHERE id = ?');

const changes = [];
for (const r of rows) {
  let types = [];
  try {
    types = JSON.parse(r.types || '[]');
  } catch {
    continue;
  }
  if (!types.length) continue;
  // The types array leads with the primary type, which is the field
  // categorize() wants first and which isn't stored separately.
  const next = categorize(types[0], types);
  if (next !== r.category) changes.push({ id: r.id, name: r.name, from: r.category, to: next });
}

const tally = {};
for (const c of changes) tally[`${c.from} -> ${c.to}`] = (tally[`${c.from} -> ${c.to}`] || 0) + 1;

console.log(`${changes.length} of ${rows.length} venues change category`);
console.log(tally);

if (dry) {
  console.log('\n(dry run — nothing written)');
  changes.slice(0, 15).forEach((c) => console.log(`  ${c.name}: ${c.from} -> ${c.to}`));
} else {
  db.transaction(() => changes.forEach((c) => setCategory.run(c.to, c.id)))();
  console.log('Updated.');
}
