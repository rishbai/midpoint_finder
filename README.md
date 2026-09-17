# midpoint

Find restaurants, cafes, and bars in Manhattan by what you actually want ("happy hour that goes past 7pm," a price, a cuisine, a specific dish), invite friends to a plan, and find the spot that's fair for everyone to get to — whichever of walking or transit (subway, bus, rail) is actually faster for each person.

## How it works

1. **Ingest** (`server/scripts/ingest.js`) sweeps a grid over Manhattan with the Google Places API and saves venues, including opening hours, to a local SQLite database. When a search area returns the max 20 results, it splits into smaller circles so dense blocks don't get missed.
2. **Tag** (`server/scripts/tag.js`) sends each venue's reviews to Claude and saves vibe tags (date night, happy hour, work friendly, etc.) and praised dishes.
3. **Search** runs entirely against the local database, so filtering costs nothing per query. A free-text box ("Ask") sends what you typed to Claude, which turns it into structured filters — category, vibe, price, and an "open until" day/time check against the venue's real hours. The same filters (plus that free-text box) are also available when creating or editing a plan.
4. **Accounts and friends**: sign up, add friends by email, accept/decline requests.
5. **Plans**: a host describes what they're looking for and invites friends. Each invitee opens the plan and shares their location (browser geolocation, or a typed address as a fallback) — shown live on a map. Once at least two people have shared, the host can find spots, and re-share their location later if plans change.
6. **Meet in the middle** takes everyone's location, pulls the best matching venues near the geographic center, then gets real travel times from each person to each venue by both transit and walking (Google Routes API), taking whichever is faster per person — someone six blocks away walks, someone across town takes the train. Venues are ranked by the longest trip anyone has to make, with a penalty when trip times are lopsided. Clicking "See routes" on a result fetches the actual step-by-step directions per person (which line, how many stops, walk segments) on demand.
7. **Descriptions** are grounded in each venue's real Google reviews and whatever you asked for — a plan for "late happy hour" surfaces "$5 cocktails until 8pm" if a review says so, not a generic category line (`server/src/services/describe.js`).

Note: Mapbox isochrones don't support transit, so this uses Google's route matrix instead of isochrone intersection — one matrix call for transit, one for walking, best-of per person.

## Setup

Requires Node 20.6+.

```bash
# API
cd server
cp .env.example .env      # add your keys
npm install
npm run ingest            # dev area only (small, cheap)
npm run tag
npm run dev               # http://localhost:3001

# UI (new terminal)
cd client
npm install
npm run dev               # http://localhost:5173
```

### Google Cloud APIs to enable
- Places API (New)
- Geocoding API
- Routes API

### Ingesting all of Manhattan
```bash
npm run ingest -- --area=manhattan --yes
```
This makes thousands of Places calls and requesting reviews puts you in a higher pricing tier. Check Google's current pricing and set a budget alert first. Start with `--area=dev` until everything works.

### Backfilling hours on an existing database
Venues ingested before hours were tracked have `hours = NULL`, which makes them invisible to any "open at/past X" filter. Fill them in with a cheap, hours-only Place Details call:
```bash
npm run backfill-hours
```
Then re-run `npm run tag -- --retag` if you want the `happy_hour` vibe (added alongside hours support) applied to existing venues.

## Layout

```
server/
  scripts/ingest.js         pull venues from Google Places
  scripts/tag.js            vibe + dish tags from reviews
  scripts/backfill-hours.js fills in hours for venues ingested before it was tracked
  src/index.js              Express app
  src/db.js                 SQLite schema (venues, users, friendships, plans, ...)
  src/lib/vocab.js          categories, vibes, price mapping
  src/lib/hours.js          "is this venue open at this day/time" logic
  src/lib/auth.js           password hashing, sessions, requireAuth middleware
  src/services/google.js    Places, Geocoding, Routes calls (matrix + step-by-step directions)
  src/services/search.js    filter query builder (incl. hours filter)
  src/services/query.js     free text -> structured filters, via Claude
  src/services/describe.js  review-grounded venue descriptions, via Claude
  src/services/meetup.js    meet-in-the-middle ranking (best of transit/walk per person)
  src/services/plans.js     create/edit/delete a plan, invite, share location, results, route detail
  src/routes/               /api/venues, /api/meta, /api/meetup, /api/auth, /api/friends, /api/plans, /api/query
client/
  src/App.jsx               tabs: Plans / Find a spot / Friends (Plans is the landing tab)
  src/auth.jsx              AuthProvider/useAuth (session cookie, current user)
  src/components/           Filters, VenueCard, SearchView, Plans, NewPlan, PlanForm, PlanDetail, PlanMap, Friends, AuthPanel
```

## API

- `GET /api/meta` — categories, vibes, cuisines in the database
- `GET /api/venues?category=bar&maxPrice=2&vibes=date_night,cozy&dish=negroni&lat=..&lng=..&radius=1000&openDay=5&openMinutes=1320`
- `GET /api/venues/:id`
- `POST /api/query` — `{ "q": "happy hour that goes past 7pm" }` → `{ filters, results }`, filters parsed by Claude, each result's `description` grounded in its real reviews
- `POST /api/meetup` — anonymous, address-based quick check: `{ "addresses": ["...", "..."], "filters": { ... }, "departureTime": "optional ISO" }`

Everything below requires a session cookie (`POST /api/auth/login` or `/signup` sets it):

- `POST /api/auth/signup` / `/api/auth/login` / `/api/auth/logout`, `GET /api/auth/me`
- `GET /api/users/search?email=...`, `GET /api/friends`, `POST /api/friends/requests`, `POST /api/friends/requests/:id/accept|decline`
- `POST /api/plans` — `{ title, queryText, filters, plannedFor, friendIds: [...] }`
- `GET /api/plans` — plans you host or are invited to
- `GET /api/plans/:id`, `PATCH /api/plans/:id` (host only), `DELETE /api/plans/:id` (host only)
- `POST /api/plans/:id/invite` — `{ friendIds: [...] }` (host only, adds to an existing plan)
- `POST /api/plans/:id/respond` (`{ action: "joined" | "declined" }`), `POST /api/plans/:id/leave` (non-host)
- `POST /api/plans/:id/location` — `{ lat, lng }` (browser geolocation) or `{ address }` (typed fallback); re-shareable, not one-time
- `GET /api/plans/:id/results` — ranked venues once at least two participants have shared a location, each leg using whichever of transit/walking is faster (costs Routes API calls per refresh, so it's fetched on request, not polled)
- `GET /api/plans/:id/routes/:venueId` — step-by-step directions per participant to that one venue (which line, how many stops), fetched on demand when a result is expanded

## Next steps
- Push/email notification on invite, instead of checking the Plans tab
- Continuously-updating live location (currently a manual re-share, not automatic)
- Scheduled refresh of the venue database
- Bike/drive as additional travel modes (currently just transit + walking)
