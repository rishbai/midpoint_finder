// Tag venues with vibes and praised dishes by sending their reviews to Claude.
//   npm run tag                 untagged venues, up to 500
//   npm run tag -- --limit=50
//   npm run tag -- --retag      redo venues that already have tags
//   npm run tag -- --retag --category=bar   ...just one category, when a new
//                               vibe only matters there (see lib/vocab.js)

import { db } from '../src/db.js';
import { tagVenues, TAG_MODEL } from '../src/services/tagging.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const LIMIT = Number(args.limit) || 500;

const venues = db.prepare(`
  SELECT id, name, category, cuisine, reviews FROM venues
  WHERE reviews IS NOT NULL AND reviews != '[]'
  ${args.retag ? '' : 'AND tagged_at IS NULL'}
  ${args.category ? 'AND category = @category' : ''}
  ORDER BY rating_count DESC
  LIMIT @limit
`).all({ limit: LIMIT, ...(args.category ? { category: args.category } : {}) });

async function main() {
  console.log(`Tagging ${venues.length} venues with ${TAG_MODEL}`);
  const { done, failed } = await tagVenues(venues, {
    onProgress: ({ done, failed, total }) => console.log(`${done + failed}/${total} (${failed} failed)`),
  });
  console.log(`Done. ${done} tagged, ${failed} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
