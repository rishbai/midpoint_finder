import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client with the service role key: it can create and
// delete users outright, so it never leaves this process. Null until the
// env is set, and everything that uses it checks for that.
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin =
  url && key ? createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
