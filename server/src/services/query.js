// Turns a free-text ask ("good Indian food, open past 9pm", "quiet coffee
// shop to work from this afternoon") into the structured filters search.js
// expects.
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
  "dish": a specific dish or order mentioned, lowercase (e.g. "espresso tonic"),
  "minPrice": 1-4,
  "maxPrice": 1-4,
  "minRating": number like 4.5,
  "openDay": integer 0-6 (0=Sunday..6=Saturday), only if a specific day is implied,
  "openMinutes": integer minutes since midnight, the time the place must still be open at,
  "dealsUntil": integer minutes since midnight — use ONLY for a discount window that runs late,
  "q": free-text venue name if they named a specific place
}

Rules:
- A request about discounted hours ("happy hour", "specials", "cheap happy hour") implies vibes: ["happy_hour"] AND category: "bar", unless a specific food dish or cuisine is also named. Both halves matter: without the category, "cheap happy hour" just means "cheap", and matches pizza and bagels.
- In that same case, do NOT set maxPrice, even when they say "cheap" or "deals". The price tiers describe a venue's normal pricing, and the whole point of a discount window is that it isn't normal pricing — a tier-2 place with a real deal is exactly what was asked for, and filtering to tier 1 throws it away.
- When the ask is about that discount window itself running late ("deals going late", "specials past 9"), set dealsUntil to that time (bare "late" -> 1260, i.e. 9pm) and do NOT set openDay/openMinutes. Those two are about the venue's own closing time, which is a different question — a place open till 4am whose discount ended at 6pm is exactly what this person doesn't want.
- Words for a venue that serves mainly drinks, when no specific food dish is also named, imply category: "bar". Don't let this get dropped just because no other word for that category is present — it's what keeps such a request from matching a bagel shop.
- "coffee"/"a cafe"/"to work from" imply category: "cafe".
- Plain praise with nothing else specific ("good food", "great food", "amazing food", "quality food") implies category: "restaurant" and minRating: 4.5. Don't leave a request like this with no filters at all — "good" specifically means a rating floor, not "anything." Without it, a search just ranks by review volume, which rewards busy tourist/arcade spots over actual food quality.
- openMinutes = hour*60 + minute, using a 24-hour hour. Convert carefully: 7pm = 19:00 = 19*60 = 1140. 11pm = 23:00 = 1380. 9am = 9:00 = 540.
- openDay and openMinutes always travel together: never set one without the other.
- If they give a time ("past 7pm", "after 9", "still open at 11") without naming a day, use today: openDay ${today.day} (${DAY_NAMES[today.day]}), openMinutes = that time converted as above.
- If they name a day ("Friday night"), set openDay to that weekday's index (0=Sunday..6=Saturday) and, if no exact time is given, use 21:00 -> openMinutes 1260 for "night".
- Price words, using Google's actual tiers (1=Inexpensive, 2=Moderate, 3=Expensive, 4=Very Expensive): "cheap"/"budget"/"inexpensive" -> maxPrice 1 (not 2 — moderate is not cheap). "affordable"/"reasonable" -> maxPrice 2. "upscale"/"fancy"/"nice" -> minPrice 3, and add vibe "upscale".
- Only include a key when the request actually supports it. It's fine to return {}.

Example: "somewhere still open past 7pm" with today = ${DAY_NAMES[today.day]} (index ${today.day}) ->
{"openDay": ${today.day}, "openMinutes": 1140}`;
}

// Did they ask about a discount window, as opposed to just a cheap venue?
const ASKED_ABOUT_A_DISCOUNT = /happy\s*hour|\bhh\b|\bspecials?\b|\bdeals?\b/i;

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

  // A price tier describes what a place charges normally, and a discount
  // window is by definition not normal pricing — so "cheap happy hour" must
  // not become "tier-1 venues that also happen to have a happy hour". That
  // reading throws away the closest, best-matching places for no reason.
  // The model follows this from the prompt most of the time but not reliably,
  // and the difference is the whole result set, so it's enforced here too.
  //
  // Only when they actually asked about a discount, though. The model also
  // infers the happy_hour vibe from "cheap drinks", where "cheap" really does
  // mean the venue should be inexpensive — dropping the price there would be
  // answering a different question. A price set by hand never reaches this.
  if (parsed.vibes?.includes('happy_hour') && ASKED_ABOUT_A_DISCOUNT.test(text)) {
    delete parsed.maxPrice;
  }

  return normalizeFilters(parsed);
}
