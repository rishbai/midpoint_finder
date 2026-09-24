import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'venues.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS venues (
    id           TEXT PRIMARY KEY,   -- Google place id
    name         TEXT NOT NULL,
    address      TEXT,
    lat          REAL NOT NULL,
    lng          REAL NOT NULL,
    category     TEXT,               -- restaurant | cafe | bar | other
    cuisine      TEXT,               -- e.g. italian, japanese
    price_level  INTEGER,            -- 1-4
    rating       REAL,
    rating_count INTEGER,
    types        TEXT,               -- JSON array
    reviews      TEXT,               -- JSON array of review text
    hours        TEXT,               -- JSON: Google regularOpeningHours
    tagged_at    TEXT,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_venues_latlng   ON venues(lat, lng);
  CREATE INDEX IF NOT EXISTS idx_venues_category ON venues(category);

  CREATE TABLE IF NOT EXISTS venue_tags (
    venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    kind     TEXT NOT NULL CHECK (kind IN ('vibe', 'dish')),
    tag      TEXT NOT NULL,
    PRIMARY KEY (venue_id, kind, tag)
  );
  CREATE INDEX IF NOT EXISTS idx_tags_tag ON venue_tags(kind, tag);

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    is_guest      INTEGER NOT NULL DEFAULT 0, -- joined via a plan's invite link, no real email/password
    friend_invite_token TEXT,          -- this user's personal "add me" link (see routes/friends.js)
    supabase_id   TEXT,                -- Supabase Auth user id, once login moved there (see lib/auth.js)
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  -- Friendship is one row per pair, directional (requester -> addressee) until accepted.
  CREATE TABLE IF NOT EXISTS friendships (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
    created_at    TEXT NOT NULL,
    UNIQUE (requester_id, addressee_id)
  );
  CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status);
  CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status);

  -- A plan is "find us a spot" shared with invited friends.
  CREATE TABLE IF NOT EXISTS plans (
    id          TEXT PRIMARY KEY,
    host_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    query_text  TEXT,               -- what the host typed, e.g. "good Indian food, open past 9pm"
    filters     TEXT NOT NULL,      -- JSON, parsed/structured filters
    planned_for TEXT,               -- ISO datetime, optional
    status      TEXT NOT NULL DEFAULT 'gathering' CHECK (status IN ('gathering', 'closed')),
    share_token TEXT,               -- opens the plan for anyone with the link (see services/plans.js)
    resolved_modes TEXT,            -- JSON array: what the last ranking actually priced
    results_json  TEXT,             -- last computed results (see services/plans.js)
    results_key   TEXT,             -- the inputs they were computed from; stale when it changes
    results_at    TEXT,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_plans_host ON plans(host_id);

  CREATE TABLE IF NOT EXISTS plan_participants (
    plan_id    TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'joined', 'declined')),
    lat        REAL,
    lng        REAL,
    address    TEXT,               -- reverse-geocoded or typed fallback label
    shared_at  TEXT,
    -- How this person travels *for this plan*: at home they take the subway,
    -- visiting family they drive. It's a property of the trip, not the person,
    -- so it lives here rather than on the account. NULL means "any way".
    travel_modes TEXT,
    -- Added by the host from just a name and address, with no account of
    -- their own — so the host is the one who maintains their details.
    added_by_host INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (plan_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_plan_participants_user ON plan_participants(user_id, status);

  -- Tracks which ~1km grid cells have already had an on-demand Places sweep
  -- (services/liveIngest.js), so a busy neighborhood doesn't get re-fetched
  -- (and re-billed) on every plan that meets there.
  CREATE TABLE IF NOT EXISTS covered_cells (
    cell       TEXT PRIMARY KEY,
    covered_at TEXT NOT NULL
  );
`);

// Older databases created before a column existed. ALTER TABLE is the only
// way SQLite adds a column to an existing table (and can't add constraints
// retroactively, hence the separate unique index below for share_token
// rather than a UNIQUE column definition).
const venueColumns = db.prepare("PRAGMA table_info(venues)").all().map((c) => c.name);
if (!venueColumns.includes('hours')) {
  db.exec('ALTER TABLE venues ADD COLUMN hours TEXT');
}

// When a venue's discounted hours actually run, pulled from review text by
// the tagger: JSON [{start, end}, ...] in minutes since midnight. Plural
// because places really do run two — an early-evening window and a late one —
// and the late one is often the whole point of asking. An end past midnight
// is stored beyond 1440 so "still on at X" is a plain compare. Google has no
// API for this, so reviews are the only source and it's often null.
if (!venueColumns.includes('hh_windows')) {
  db.exec('ALTER TABLE venues ADD COLUMN hh_windows TEXT');
}

const userColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userColumns.includes('is_guest')) {
  db.exec('ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0');
}
if (!userColumns.includes('friend_invite_token')) {
  db.exec('ALTER TABLE users ADD COLUMN friend_invite_token TEXT');
}
if (!userColumns.includes('supabase_id')) {
  db.exec('ALTER TABLE users ADD COLUMN supabase_id TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_supabase_id ON users(supabase_id)');
const untokenedUsers = db.prepare('SELECT id FROM users WHERE friend_invite_token IS NULL').all();
if (untokenedUsers.length) {
  const setToken = db.prepare('UPDATE users SET friend_invite_token = ? WHERE id = ?');
  db.transaction(() => {
    for (const { id } of untokenedUsers) setToken.run(crypto.randomBytes(8).toString('hex'), id);
  })();
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_friend_invite_token ON users(friend_invite_token)');

const participantColumns = db.prepare('PRAGMA table_info(plan_participants)').all().map((c) => c.name);
if (!participantColumns.includes('travel_modes')) {
  db.exec('ALTER TABLE plan_participants ADD COLUMN travel_modes TEXT');
}
if (!participantColumns.includes('added_by_host')) {
  db.exec('ALTER TABLE plan_participants ADD COLUMN added_by_host INTEGER NOT NULL DEFAULT 0');
}

const planColumns = db.prepare("PRAGMA table_info(plans)").all().map((c) => c.name);
if (!planColumns.includes('share_token')) {
  db.exec('ALTER TABLE plans ADD COLUMN share_token TEXT');
}
// Whether driving got priced is a decision about the group as a whole, not
// about one leg — so the step-by-step view has to be told, not left to
// re-derive it and disagree. Written by computePlanResults.
if (!planColumns.includes('resolved_modes')) {
  db.exec('ALTER TABLE plans ADD COLUMN resolved_modes TEXT');
}
// Results are the expensive part of a plan — a travel-time matrix per mode,
// billed per person per venue — and "Refresh spots" re-ran all of it even
// when nothing had changed. Cached against the inputs that produced them.
for (const col of ['results_json', 'results_key', 'results_at']) {
  if (!planColumns.includes(col)) db.exec(`ALTER TABLE plans ADD COLUMN ${col} TEXT`);
}
// Plans created before invite links existed don't have a token yet.
const untokened = db.prepare('SELECT id FROM plans WHERE share_token IS NULL').all();
if (untokened.length) {
  const setToken = db.prepare('UPDATE plans SET share_token = ? WHERE id = ?');
  db.transaction(() => {
    for (const { id } of untokened) setToken.run(crypto.randomBytes(8).toString('hex'), id);
  })();
}
// Only safe to add now that every row has a (unique) value.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_share_token ON plans(share_token)');
