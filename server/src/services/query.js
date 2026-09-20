// Turns a free-text ask ("happy hour that goes past 7pm", "quiet coffee shop
// to work from this afternoon") into the structured filters search.js expects.
import Anthropic from '@anthropic-ai/sdk';
import { CATEGORY_TYPES, VIBES } from '../lib/vocab.js';
import { listCuisines, normalizeFilters } from './search.js';
import { dayAndMinutesAt, DAY_NAMES } from '../lib/hours.js';

const MODEL = process.env.QUERY_MODEL || 'claude-haiku-4-5-20251001';
const client = new Anthropic(); // reads ANTHROPIC_API_KEY

function buildSystemPrompt(now) {
  // No location is known yet at this point (see lib/hours.js) — "today" is a
  // reasonable guess, not the source of truth; the actual open/closed check
  // later (search.js) always uses each venue's real location.
  const today = dayAndMinutesAt(now);
  return `You turn a person's plain-English request for a place to go into a JSON filter object. Reply with JSON only, no prose, no code fences.

Schema (omit any key you have no evidence for):
{
  "category": one of ${JSON.stringify(Object.keys(CATEGORY_TYPES).concat('other'))},
  "cuisine": lowercase cuisine word, e.g. "italian", "japanese" (omit if not a restaurant ask),
  "vibes": array, only from ${JSON.stringify(VIBES)},
  "dish": a specific dish or drink mentioned, lowercase (e.g. "espresso tonic"),
  "minPrice": 1-4,
  "maxPrice": 1-4,
  "minRating": number like 4.5,
  "openDay": integer 0-6 (0=Sunday..6=Saturday), only if a specific day is implied,
  "openMinutes": integer minutes since midnight, the time the place must still be open at,
  "happyHourUntil": integer minutes since midnight — use ONLY for happy hour that runs late,
  "q": free-text venue name if they named a specific place
}

Rules:
- "happy hour" implies vibes: ["happy_hour"].
- When the ask is about the happy hour itself running late or until some time ("happy hour that goes late", "late happy hour", "deals going late", "happy hour past 9"), set happyHourUntil to that time (bare "late" -> 1260, i.e. 9pm) and do NOT set openDay/openMinutes. Those two are about the venue's own closing time, which is a different question — a bar open till 4am whose happy hour ended at 6pm is exactly what this person doesn't want.
- "drinks"/"cocktails"/"beer"/"wine"/"a bar"/"happy hour", when no specific food dish is also named, imply category: "bar". Don't let this get dropped just because no other bar-specific word is present — it's what keeps "cheap drinks" from matching a bagel shop.
- "coffee"/"a cafe"/"to work from" imply category: "cafe".
- Plain praise with nothing else specific ("good food", "great food", "amazing food", "quality food") implies category: "restaurant" and minRating: 4.5. Don't leave a request like this with no filters at all — "good" specifically means a rating floor, not "anything." Without it, a search just ranks by review volume, which rewards busy tourist/arcade spots over actual food quality.
- openMinutes = hour*60 + minute, using a 24-hour hour. Convert carefully: 7pm = 19:00 = 19*60 = 1140. 11pm = 23:00 = 1380. 9am = 9:00 = 540.
- openDay and openMinutes always travel together: never set one without the other.
- If they give a time ("past 7pm", "after 9", "still open at 11") without naming a day, use today: openDay ${today.day} (${DAY_NAMES[today.day]}), openMinutes = that time converted as above.
- If they name a day ("Friday night"), set openDay to that weekday's index (0=Sunday..6=Saturday) and, if no exact time is given, use 21:00 -> openMinutes 1260 for "night".
- Price words, using Google's actual tiers (1=Inexpensive, 2=Moderate, 3=Expensive, 4=Very Expensive): "cheap"/"budget"/"inexpensive" -> maxPrice 1 (not 2 — moderate is not cheap). "affordable"/"reasonable" -> maxPrice 2. "upscale"/"fancy"/"nice" -> minPrice 3, and add vibe "upscale".
- Only include a key when the request actually supports it. It's fine to return {}.

Example: "happy hour that goes past 7pm" with today = ${DAY_NAMES[today.day]} (index ${today.day}) ->
{"vibes": ["happy_hour"], "openDay": ${today.day}, "openMinutes": 1140}`;
}

export async function parseQuery(text, referenceTime) {
  const now = referenceTime ? new Date(referenceTime) : new Date();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: buildSystemPrompt(now),
    messages: [{ role: 'user', content: String(text).slice(0, 500) }],
  });
  const raw = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    parsed = {};
  }

  const cuisines = new Set(listCuisines());
  if (parsed.cuisine && !cuisines.has(parsed.cuisine)) delete parsed.cuisine;
  if (!Object.keys(CATEGORY_TYPES).includes(parsed.category)) delete parsed.category;
  if (Array.isArray(parsed.vibes)) parsed.vibes = parsed.vibes.filter((v) => VIBES.includes(v));

  // Belt and suspenders: don't let a model slip that forgets the day silently
  // disable the hours filter (search.js requires both fields together).
  if (parsed.openMinutes != null && parsed.openDay == null) {
    parsed.openDay = dayAndMinutesAt(now).day;
  }
  if (parsed.openDay != null && parsed.openMinutes == null) delete parsed.openDay;

  return normalizeFilters(parsed);
}
