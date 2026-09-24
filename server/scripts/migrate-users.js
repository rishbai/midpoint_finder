// Moves existing accounts into Supabase Auth so nobody has to sign up again.
//   node scripts/migrate-users.js --dry
//   node scripts/migrate-users.js
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Each real (non-guest)
// account that isn't linked yet is created in Supabase with its existing
// bcrypt hash, so the same password keeps working, and the Supabase id is
// written back to users.supabase_id. Guests and address-added placeholders
// have no login to move and are left alone. Safe to re-run: linked rows are
// skipped, and an email that already exists in Supabase is linked by lookup.
import { db } from '../src/db.js';
import { supabaseAdmin } from '../src/lib/supabaseAdmin.js';

if (!supabaseAdmin) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
  process.exit(1);
}
const dry = process.argv.includes('--dry');

const pending = db
  .prepare('SELECT id, email, name, password_hash FROM users WHERE is_guest = 0 AND supabase_id IS NULL')
  .all();
const link = db.prepare('UPDATE users SET supabase_id = ? WHERE id = ?');

console.log(`${pending.length} account(s) to move${dry ? ' (dry run)' : ''}`);

let moved = 0;
for (const u of pending) {
  if (dry) {
    console.log(`  would move ${u.email}`);
    continue;
  }
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: u.email,
    password_hash: u.password_hash,
    email_confirm: true,
    user_metadata: { name: u.name },
  });
  if (error) {
    // Already there from an earlier run or a fresh sign-up: find and link.
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users?.find((x) => x.email?.toLowerCase() === u.email.toLowerCase());
    if (!existing) {
      console.log(`  ${u.email}: ${error.message}`);
      continue;
    }
    link.run(existing.id, u.id);
    console.log(`  linked ${u.email} (already in Supabase)`);
  } else {
    link.run(data.user.id, u.id);
    console.log(`  moved ${u.email}`);
  }
  moved++;
}
console.log(dry ? 'Nothing written.' : `Done. ${moved} moved or linked.`);
