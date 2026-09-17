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
const markTagged = db.prepare('UPDATE venues SET tagged_at = ? WHERE id = ?');

const saveTags = db.transaction((id, vibes, dishes) => {
  clearTags.run(id);
  vibes.forEach((t) => addTag.run(id, 'vibe', t));
  dishes.forEach((t) => addTag.run(id, 'dish', t));
  markTagged.run(new Date().toISOString(), id);
});

function buildPrompt(v) {
  const reviews = JSON.parse(v.reviews).map((r, i) => `${i + 1}. ${r}`).join('\n');
  return `Venue: ${v.name} (${[v.category, v.cuisine].filter(Boolean).join(', ')})

Reviews:
${reviews}

Return JSON: {"vibes": [...], "dishes": [...]}
- vibes: only from this list, and only when the reviews clearly support it: ${VIBES.join(', ')}
- dishes: specific dishes or drinks reviewers praise, lowercase and short (e.g. "cacio e pepe"). Max 8. Empty list if none.`;
}

// v needs: id, name, category, cuisine, reviews (JSON string).
export async function tagVenueRow(v) {
  const msg = await client.messages.create({
    model: TAG_MODEL,
    max_tokens: 300,
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

  saveTags(v.id, vibes, dishes);
  return { vibes, dishes };
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
