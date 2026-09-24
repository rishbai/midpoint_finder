# midpoint on the App Store

The native app is the website inside a Capacitor shell: the same React code,
the same Railway API. Two things differ from the website and are already in
place: login uses Supabase (cookies don't work inside the shell), and the app
talks to the API directly instead of through Vercel's proxy.

Everything below is in the order it needs to happen. Steps marked **you** need
your accounts or your Mac; the rest is done.

## 1. Supabase project (you, ~10 minutes, free)

1. Create a project at supabase.com. Any region; "Free" plan.
2. **Authentication → Providers → Email**: turn **Confirm email OFF** for now.
   Two flows depend on it: someone who joined by invite link adding an email
   and password to keep their account, and a straightforward sign-up. You can
   turn it back on later once you're happy with the flows.
3. **Authentication → Sign In / Providers**: enable **Anonymous sign-ins**.
   That's how an invite-link visitor gets an identity without signing up.
4. **Project Settings → API**, copy three values:
   - Project URL
   - `anon` `public` key
   - `service_role` key (secret; server only)
5. Set them:
   - Railway (API): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. If the project
     shows a "JWT Secret" under API settings (older projects), also
     `SUPABASE_JWT_SECRET`; newer projects don't need it.
   - Vercel (website): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, then
     redeploy. From that deploy on, the website signs in through Supabase.
   - `client/.env.local` (for your native build): the same two `VITE_` values,
     plus `VITE_API_URL=https://midpoint-api-production.up.railway.app`.

Then move existing accounts over so nobody has to sign up again. From
`server/`, with the Railway env available (`railway ssh`):

    node scripts/migrate-users.js --dry
    node scripts/migrate-users.js

Passwords carry over as-is (the hashes are compatible). Guests and people
added by address have no login and are left alone.

## 2. Xcode (you, free, ~10 GB)

Install Xcode from the Mac App Store, open it once to accept the license, then:

    sudo xcode-select -s /Applications/Xcode.app/Contents/Developer

Right now the Mac only has the command-line tools, which can't build for iOS.

## 3. Apple Developer Program (you, $99/year)

Enroll at developer.apple.com. This is the one unavoidable cost. It usually
takes a day or two to be approved.

## 4. Build the iOS project (once Xcode is installed)

The iOS project already exists at `client/ios/` with the icon, splash, the
built web app, and the location-permission text in place. From `client/`:

    npm run cap:open         # opens Xcode

In Xcode, with the `App` target selected, under **Signing & Capabilities**
pick your team (from step 3). Xcode manages the rest. The bundle id is
`com.midpointfinder.app` (set in `client/capacitor.config.json`; change it
there and re-run `npx cap sync ios` before the first build if you want a
different one).

Run on a simulator or your phone from Xcode to check it. Each time the web
code changes: `npm run cap:sync`, then run again from Xcode.

## 5. App Store Connect (you)

1. appstoreconnect.apple.com → My Apps → **+** → New App. Bundle id from
   step 4, any name and SKU.
2. **App Privacy**: declare Name, Email, Precise Location (used for app
   functionality, linked to the user, not used for tracking), and User Content.
   The privacy policy URL is `https://midpointfinderapp.vercel.app/privacy`.
3. Screenshots: run on an iPhone 15 Pro Max simulator, Cmd-S to save; Apple
   needs 6.7" ones at minimum.
4. In Xcode: Product → Archive → Distribute App → App Store Connect. The build
   appears in TestFlight within about an hour; add yourself and your family as
   testers there first. When it's right, submit for review from the same page.

Review usually takes one to three days. The app already meets the things that
commonly cause rejections for wrapped apps: in-app account deletion, a privacy
policy, a native location prompt, and real functionality beyond a website.

## What changed in the code

- `server/src/lib/auth.js`: accepts a Supabase bearer token as well as the
  old session cookie. A person is created in `users` on first sight and linked
  by `supabase_id`; an anonymous Supabase user is a guest, promoted in place
  when they add an email.
- `server/src/routes/auth.js`: `DELETE /api/auth/me` deletes the account
  everywhere (Apple requires this in-app), `PATCH /api/auth/me` updates the name.
- `client/src/supabase.js`, `client/src/auth.jsx`, `client/src/api.js`: one
  `useAuth()` hook, two backends; every request carries the token when
  Supabase is on.
- `client/src/geo.js`: native location on a phone, browser geolocation on the
  web.
- `client/capacitor.config.json`, `client/assets/`: the shell and its images.
- `client/src/components/Privacy.jsx`: the policy page, at `/privacy`.
