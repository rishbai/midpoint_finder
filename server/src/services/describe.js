// Generates a short, review-grounded blurb per venue explaining why it fits
// what someone actually asked for — "happy hour that goes past 7pm" should
// surface "$5 cocktails until 8pm" if a review says so, not a generic
// category line. One Claude call covers the whole shortlist (not one per
// venue), same cost shape as query parsing.
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db.js';

const MODEL = process.env.DESCRIBE_MODEL || 'claude-haiku-4-5-20251001';
const MAX_VENUES = 25;
const client = new Anthropic(); // reads ANTHROPIC_API_KEY

// venues: anything with an `id` (venue rows or venue-shaped objects).
// Returns { [venueId]: "short phrase" } — ids omitted when reviews don't
// support anything specific are left out, so callers should fall back to
// their normal description for those.
export async function describeForQuery(queryText, venues) {
  const text = String(queryText || '').trim();
  if (!text || !venues?.length) return {};

  const shortlist = venues.slice(0, MAX_VENUES);
  const ids = shortlist.map((v) => v.id);
  const rows = db
    .prepare(`SELECT id, reviews FROM venues WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids);
  const reviewsById = Object.fromEntries(
    rows.map((r) => [r.id, (JSON.parse(r.reviews || '[]') || []).slice(0, 4)])
  );

  const prompt = shortlist
    .map((v) => {
      const reviews = reviewsById[v.id] || [];
      return `id: ${v.id}\nname: ${v.name}\nreviews: ${reviews.length ? reviews.join(' | ') : 'none'}`;
    })
    .join('\n\n');

  let msg;
  try {
    msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: `Someone is looking for: "${text}"

For each venue below, write ONE short phrase (under 12 words, no ending period) that explains specifically why it fits that request — pull concrete facts from the reviews only: prices, times, specials, a specific dish, what people say about the vibe. If the reviews don't actually support anything specific to "${text}", leave that venue's id out entirely rather than guessing or writing something generic.

Reply with JSON only, no prose, no code fences: {"<venueId>": "<phrase>", ...}`,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch {
    return {}; // descriptions are a nice-to-have; never break search over this
  }

  const raw = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}
