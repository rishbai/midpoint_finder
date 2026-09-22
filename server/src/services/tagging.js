// Vibe + dish extraction from a venue's reviews, via Claude. Shared by the
// batch CLI script (scripts/tag.js) and on-demand live ingest
// (services/liveIngest.js), which tags venues the moment they're fetched.
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db.js';
import { VIBES } from '../lib/vocab.js';

export const TAG_MODEL = process.env.TAG_MODEL || 'claude-haiku-4-5-20251001';
const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const clearTags = db.prepare('DELETE FROM venue_tags WHERE venue_id = ?');
const addTag = db.prepare('INSERT OR IGNORE INTO venue_tags (venue_id, kind, tag) VALUES (?, ?, ?)');
const markTagged = db.prepare('UPDATE venues SET tagged_at = ?, hh_windows = ? WHERE id = ?');

const saveTags = db.transaction((id, vibes, dishes, windows) => {
  clearTags.run(id);
  vibes.forEach((t) => addTag.run(id, 'vibe', t));
  dishes.forEach((t) => addTag.run(id, 'dish', t));
  markTagged.run(new Date().toISOString(), windows?.length ? JSON.stringify(windows) : null, id);
});

function buildPrompt(v) {
  const reviews = JSON.parse(v.reviews).map((r, i) => `${i + 1}. ${r}`).join('\n');
  return `Venue: ${v.name} (${[v.category, v.cuisine].filter(Boolean).join(', ')})

Reviews:
${reviews}

Return JSON: {"vibes": [...], "dishes": [...], "dealWindows": [{"start": <minutes|null>, "end": <minutes>}, ...]}
- vibes: only from this list, and only when the reviews clearly support it: ${VIBES.join(', ')}
- good_value specifically: reviewers say it's cheap, a good deal, or well priced for what you get ("$6 drafts", "cheap pints", "can't beat the prices", "dive bar prices"). Judge it from what they say, not from how fancy the place sounds — plenty of plain places are expensive and plenty of scruffy ones are not.
- dishes: specific items reviewers praise, lowercase and short (e.g. "cacio e pepe"). Max 8. Empty list if none.
- dealWindows: every distinct discounted window the reviews give actual hours for. Minutes since midnight: 4pm = 960, 7pm = 1140, 10pm = 1320, midnight = 1440, 2am = 1560.
  - "specials 4-7pm" -> [{"start": 960, "end": 1140}]
  - "4-7 PM, plus a late-night window from 10 PM to midnight" -> [{"start": 960, "end": 1140}, {"start": 1320, "end": 1440}] — list BOTH; a second, later window is important, never drop it
  - "deals until 8" (evening implied) -> [{"start": null, "end": 1200}]
  - reviews mention a discount but never say when -> [] (don't guess typical hours)`;
}

// Minutes since midnight, with an end past midnight pushed beyond 1440 so
// "still on at X" stays a plain numeric compare.
function cleanWindows(raw) {
  if (!Array.isArray(raw)) return [];
  const n = (x) => (typeof x === 'number' && x >= 0 && x <= 1680 ? Math.round(x) : null);
  return raw
    .map((w) => {
      if (!w || typeof w !== 'object') return null;
      const start = n(w.start);
      let end = n(w.end);
      if (end == null) return null; // an end time is the whole point here
      if (start != null && end <= start) end += 1440; // crossed midnight
      return { start, end };
    })
    .filter(Boolean)
    .sort((a, b) => a.end - b.end)
    .slice(0, 3);
}


// v needs: id, name, category, cuisine, reviews (JSON string).
export async function tagVenueRow(v) {
  const msg = await client.messages.create({
    model: TAG_MODEL,
    max_tokens: 400,
    system: 'You extract tags from venue reviews. Reply with JSON only. No prose, no code fences.',
    messages: [{ role: 'user', content: buildPrompt(v) }],
  });
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

  const vibes = (parsed.vibes || []).filter((t) => VIBES.includes(t));
  const dishes = (parsed.dishes || [])
    .filter((d) => typeof d === 'string')
    .map((d) => d.toLowerCase().trim())
    .filter(Boolean)
    .slice(0, 8);
  // Only meaningful alongside the vibe — a window without the tag is noise.
  const dealWindows = vibes.includes('happy_hour') ? cleanWindows(parsed.dealWindows) : [];

  saveTags(v.id, vibes, dishes, dealWindows);
  return { vibes, dishes, dealWindows };
}

// Tags a batch of rows a handful at a time. onProgress, if given, fires after
// each batch with running totals (used by the CLI script for progress output).
export async function tagVenues(rows, { concurrency = 5, onProgress } = {}) {
  let done = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += concurrency) {
    const batch = rows.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map(tagVenueRow));
    results.forEach((r) => (r.status === 'fulfilled' ? done++ : failed++));
    onProgress?.({ done, failed, total: rows.length });
  }
  return { done, failed };
}
