// Run the actual meet-in-the-middle algorithm from the terminal — no
// browser, no deployment, no account needed. Same code path the app uses
// (services/meetup.js), against your local database.
//
//   npm run meetup -- --at "Astor Place, New York, NY" --at "Union Square, New York, NY"
//   npm run meetup -- --at "Jersey City, NJ" --at "Williamsburg, Brooklyn" --q "cheap drinks and good deals"
//   npm run meetup -- --at "..." --at "..." --category=bar --maxPrice=1
//   npm run meetup -- --at "Cary, NC" --at "Apex, NC" --q "mexican food" --modes=drive
//   --modes applies to everyone; --modes1/--modes2/... set one person each, so you can
//   model a real group: --modes1=walk,bus --modes2=drive

import { geocode } from '../src/services/google.js';
import { rankVenuesForPeople, MAX_PEOPLE } from '../src/services/meetup.js';
import { parseQuery } from '../src/services/query.js';
import { normalizeFilters } from '../src/services/search.js';
import { normalizeTravelModes } from '../src/lib/travelModes.js';

const argv = process.argv.slice(2);
const addresses = [];
const rest = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--at') {
    addresses.push(argv[++i]);
    continue;
  }
  if (!argv[i].startsWith('--')) continue;
  const [key, inlineValue] = argv[i].slice(2).split('=');
  if (inlineValue !== undefined) rest[key] = inlineValue;
  else if (argv[i + 1] && !argv[i + 1].startsWith('--')) rest[key] = argv[++i];
  else rest[key] = true;
}

if (addresses.length < 2 || addresses.length > MAX_PEOPLE) {
  console.log(`Usage:
  npm run meetup -- --at "<address>" --at "<address>" [--q "<free text>"] [--category=bar] [--maxPrice=2] [--vibes=happy_hour] [--departure="2026-09-20T19:00:00"] [--modes=walk,subway,bus,drive] ...

Needs 2-${MAX_PEOPLE} --at addresses. --q parses free text the same way the "Ask"/"Describe it" boxes do;
without --q, any other --flag is passed straight through as a structured filter. --departure sets when
you'd leave, for transit time-of-day accuracy (defaults to right now). --modes is any comma-separated
mix of walk, subway, bus, drive (default: all four); --modes1=... overrides it for person A, and so on.`);
  process.exit(1);
}

const letter = (i) => String.fromCharCode(65 + i);

async function main() {
  console.log(`Geocoding ${addresses.length} addresses...`);
  const geocoded = await Promise.all(addresses.map(geocode));
  const people = geocoded.map((p, i) => ({
    ...p,
    travelModes: normalizeTravelModes((rest[`modes${i + 1}`] || rest.modes || '').split(',').filter(Boolean)),
  }));
  people.forEach((p, i) =>
    console.log(`  ${letter(i)}: ${p.address}  (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})  [${p.travelModes.join(', ')}]`)
  );

  let filters;
  if (rest.q) {
    console.log(`\nParsing "${rest.q}"...`);
    filters = await parseQuery(rest.q);
  } else {
    filters = normalizeFilters(rest);
  }
  console.log('Filters:', filters);

  console.log('\nSearching + ranking (this hits the real Routes API, same as the app)...');
  const { center, results, note, modesUsed } = await rankVenuesForPeople(people, filters, rest.departure || null);

  console.log(`\nCenter: ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`);
  if (modesUsed) console.log(`Priced: ${modesUsed.join(', ').toLowerCase()}`);
  if (note) console.log(`Note: ${note}`);
  if (!results.length) {
    console.log('No matching places.');
    return;
  }

  console.log(`\n${results.length} result(s):\n`);
  results.forEach((r, i) => {
    const legs = r.minutes.map((m, j) => `${letter(j)}: ${m}min (${r.modes[j].toLowerCase()})`).join(', ');
    console.log(`${i + 1}. ${r.venue.name} — ${r.venue.address}`);
    console.log(`   ${legs}`);
    if (r.venue.description) console.log(`   "${r.venue.description}"`);
    else if (r.venue.dishes?.length) console.log(`   known for: ${r.venue.dishes.slice(0, 3).join(', ')}`);
    if (r.venue.vibes?.length) console.log(`   vibes: ${r.venue.vibes.join(', ')}`);
    console.log();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
