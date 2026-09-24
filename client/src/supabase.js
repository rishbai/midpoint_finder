import { createClient } from '@supabase/supabase-js';

// Login lives in Supabase once these two are set at build time. The anon key
// is meant to ship in a client; it can only do what a signed-out visitor can.
// Without them the app falls back to the server's own cookie login, which is
// how the website worked before and still can. The native app needs Supabase:
// cookies don't survive inside its web view.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SUPABASE_ENABLED = Boolean(url && key);

export const supabase = SUPABASE_ENABLED
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
