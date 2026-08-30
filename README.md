# Corridor

A multi-tenant booking platform for intercity rideshare operators in Ontario,
sold to those operators as a subscription.

Corridor is not a rideshare business. It owns no vehicles, employs no drivers,
sets no prices, and carries no passengers. It is software sold to small
companies that already do all of that — businesses running fixed daily
timetables between Windsor and Toronto that today take every booking by phone,
text, and WhatsApp.

The product is an **aggregator**. One passenger-facing site: search
`Toronto → Windsor, Sept 3`, see every operator's departures that day side by
side, request a seat on one.

**Live:** [corridor-cyan.vercel.app](https://corridor-cyan.vercel.app)

Design and rationale: [`docs/architecture.md`](docs/architecture.md).
The operator research the seed data is built from:
[`the operator notes`](the operator notes).

---

## Status

Phases 0–5 — the MVP — are built and deployed. An operator can be onboarded,
publish a timetable, take real bookings, run the day, and settle payment.

| Phase | Scope | State |
|---|---|---|
| 0 | Schema, RLS, auth, profiles, role routing | **built** |
| 1 | Admin: vet operators, manage cities | **built** |
| 2 | Operator setup: stops, routes, fares, timetable, fleet, team | **built** |
| 3 | Departure generation and passenger search | **built** |
| 4 | Booking: the hold, capacity, approve/decline, cancellation | **built** |
| 5 | Departure day: assignment, manifest, completion, settlement | **built** |
| 6 | In-city add-on | tables and seed data only |
| 7 | Subscription tracking, then mobile | tables only |

Not yet wired: Google OAuth (needs credentials) and a notifications table for
the in-app list.

**Email is on Resend's sandbox sender**, which delivers only to the address the
Resend account was opened with. That is a deliberate prototype constraint —
sending to anyone else needs a verified domain, and a domain costs money. So
account recovery reaches the developer's inbox and nobody else's.

It is not a silent failure. `notify()` logs the whole message — subject, body,
and any link — whenever a send is refused or no key is set, so a sign-in code
is always readable from the server console whatever the recipient. Watch
`npm run dev` while using `/forgot-password` and the code is right there.

To send to real passengers: verify a domain at
[resend.com/domains](https://resend.com/domains), then point
`NOTIFY_FROM_EMAIL` at it. Nothing in the code changes.

Signing in is email and password or Google. Phone number as a *login* is not
built: Supabase phone auth needs a paid SMS provider, and there is none yet.
Phone is still collected at signup, as the number an operator dials.

---

## Running it

Node 22+ and a Supabase project.

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run dev
```

### Supabase

1. Create a project at [supabase.com](https://supabase.com). The free tier is
   enough.
2. Copy the project URL and both keys from **Project settings → API keys**:
   - the **publishable** key (`sb_publishable_…`) is the browser one — RLS is
     what protects the data behind it;
   - the **secret** key (`sb_secret_…`) is server-only and must never reach the
     client bundle.

   The URL is `https://<ref>.supabase.co`, not the dashboard link.
3. Apply the schema:

   ```bash
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```

4. **Authentication → URL Configuration**: set the Site URL to your deployed
   origin and add all four of these to the redirect list:

   ```
   https://<your-app>/auth/callback     http://localhost:3000/auth/callback
   https://<your-app>/auth/confirm      http://localhost:3000/auth/confirm
   ```

   `/auth/callback` takes the PKCE code from Google and from Supabase's own
   confirmation emails. `/auth/confirm` takes the token hash from the reset
   links we mint ourselves and send through Resend. Email and password auth is
   on by default.

5. **Authentication → Sessions**: leave both the inactivity timeout and the
   time-box unset. Signed in stays signed in — the proxy rotates the refresh
   token on every request, and the cookie is written with an explicit 400-day
   max-age (`SESSION_COOKIE_OPTIONS` in `lib/supabase/env.ts`), so the only
   thing that signs someone out is pressing Sign out.

6. **Authentication → Providers → Email**: turn **Confirm email off**.

   With it on, a new account has to click a link before it can do anything, and
   that email goes through Supabase's shared SMTP — a couple of messages an hour,
   then `email rate limit exceeded`. It is the single largest piece of friction
   between a passenger and their first booking.

   The trade is that an address is not proven at signup. That is the right trade
   here: nothing is prepaid, an operator approves every booking by hand, and
   someone who cannot read the inbox cannot recover the account. Revisit it if
   fake signups ever become a real problem — with Resend configured as custom
   SMTP, not on Supabase's shared sender.

   `node scripts/auth-loop.mjs` asserts this is off.

### Google sign-in

The code path is complete. What it needs is an OAuth client, and the one detail
that trips people up is that **Google redirects to Supabase, not to this app** —
so the redirect URI below is a `supabase.co` address, not a `vercel.app` one.

1. **Google Cloud** → [console.cloud.google.com](https://console.cloud.google.com)
   → create or pick a project.

2. **OAuth consent screen** (newer consoles: *Google Auth Platform → Branding*):
   - User type **External**, app name `Corridor`, and a support + developer
     contact email.
   - Authorised domains: `supabase.co`, plus `vercel.app` or your custom domain.
   - Scopes: leave the defaults. `email`, `profile` and `openid` are all this
     needs, and they are the reason no Google verification review is required.
   - **Publish the app.** While it says *Testing*, only addresses you list as
     test users can sign in — everyone else gets `access_blocked`. This is the
     step people miss, and it looks like a broken button rather than a setting.

3. **Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**.
   - Authorised redirect URI — exactly this, no trailing slash:

     ```
     https://<ref>.supabase.co/auth/v1/callback
     ```

     Supabase shows you the same string on the Google provider page. For this
     project it is `https://applmxxchzbdrtwihqqn.supabase.co/auth/v1/callback`.
   - Copy the **Client ID** and **Client secret**.

4. **Supabase → Authentication → Providers → Google**: enable it, paste both
   values, save.

5. Check it: `node scripts/auth-loop.mjs` reports whether the provider is live,
   then press *Continue with Google* on `/sign-in`.

Until this is done the Google buttons return to the sign-in screen with an
explanation; email and password work regardless. Nothing in the app changes —
`signInWithGoogle` and `/auth/callback` are already written and route by role
on return.

### Becoming a platform admin

`platform_role` is not writable through any policy, and a trigger blocks the
change unless it comes from a platform admin or the service role. A direct
database session is exempt — anyone holding one could disable the trigger
anyway — so the first admin is granted from the SQL editor:

```sql
update public.profiles set platform_role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

Then `/admin` lets you add cities and vet operators.

### Demo data

```bash
node scripts/seed.mjs           # build it
node scripts/seed.mjs --remove  # take it back out
```

Builds the corridor described in `the operator notes`: 16 cities, 7
operators, 33 stops, 12 routes, ~1000 departures, and ~230 bookings across
every status. Every account signs in with `local-demo-password`;
`harbour@example.com` owns the largest operator.

The seed deliberately reproduces the awkward cases. Harbour sells
Windsor→Toronto for $45 while its legs total $105 (matrix), Second Line sells
the same pair for $93 (additive), one departure is full on its middle leg while
both ends stay open, and Pearson is a second Toronto stop so the same search
offers two drop-offs at different prices — one carrying the airport fee.

### Grants

This project was created with **"automatically expose new tables" off**, so
Supabase grants the API roles nothing by default and the migrations grant
everything explicitly. Two gates rather than one: `GRANT` decides whether a
role may touch a table at all, RLS decides which rows once it may. If you
create a project with that setting on, the app still works — you just have
Supabase's defaults underneath. `supabase/tests/grants.test.ts` describes the
intended state either way.

### The daily job

`/api/cron` rolls the 30-day departure window forward and relabels lapsed
holds. `vercel.json` schedules it; set `CRON_SECRET` or the route stays shut.

Neither job is load-bearing. Capacity excludes expired holds inline, so seats
free themselves whether or not the sweep has run.

---

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Development server. |
| `npm run build` | Production build, including a full typecheck. |
| `npm test` | Everything — unit tests and the database tests. |
| `npm run test:unit` | Fares, capacity, money, time. Fast. |
| `npm run test:db` | The real migrations against real Postgres. |
| `node scripts/auth-loop.mjs` | Signup and both recovery paths against the live database. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run db:types` | Regenerate `lib/supabase/database.types.ts` from a live schema. |
| `node scripts/seed.mjs` | Rebuild the demo data. |
| `node scripts/race-test.mjs` | Race the seat lock against the live database. |

### The database tests

`npm run test:db` applies the real migration files to
[PGlite](https://pglite.dev) — Postgres compiled to WebAssembly — with a
minimal stand-in for Supabase's `auth` schema. No Docker, no running server.

`request_booking()` under test is therefore the function that runs in
production. Each call runs in its own transaction with `set local role` and JWT
claims set the way PostgREST sets them, so RLS behaves as it will live. The
harness issues no blanket grant — it uses exactly what the grants migrations
hand out, so the tests exercise production's real privilege set.

Writing them found three real bugs, including a privilege escalation that let
any signed-in user make themselves a platform admin. Run them.

### The race test

`scripts/race-test.mjs` fires simultaneous requests at the live database, each
on its own connection, which is the only way the row lock in
`request_booking()` comes under the pressure it exists for.

It checks that contention is refused **and that non-contention is not**: four
passengers on disjoint legs must all succeed on a one-seat departure. A lock
held too coarsely would pass the oversell check while silently collapsing
per-leg capacity into per-departure capacity — a van that legitimately carries
30 bookings across five stops would carry 14, and the only symptom would be
revenue that never arrives.

---

## Where things are

```
app/
  (public)/      search, departure detail, operator profiles, sign in
  (passenger)/   my rides, booking detail, profile, ratings
  (operator)/    setup, bookings queue, departures, fleet, team
  (driver)/      today, manifest
  (admin)/       operator vetting, cities, subscriptions
  api/           manifest CSV, the daily job
components/      UI primitives, icons, navigation
lib/
  booking/       fares, capacity, search, booking and departure-day actions
  operator/      setup actions
  supabase/      clients and types
  validation/    zod schemas
supabase/
  migrations/    numbered SQL — schema, RLS, and every Postgres function
  tests/         the migrations, run against real Postgres
scripts/         seeding and the race test
```

Two rules about these boundaries:

- **`lib/booking/fares.ts` is the only module that reads `pricing_mode`.** No
  other code decides what a segment costs.
- **`lib/incity` stays isolated.** Nothing in the intercity path imports from
  it. In-city is a Phase 6 add-on and must be removable without touching the
  booking flow.

Postgres functions live in `supabase/migrations/`, not `supabase/functions/`.
A function is schema and has to replay in order onto a fresh database;
`supabase/functions/README.md` indexes which migration defines what.

---

## The parts most likely to break

Most of this app is CRUD. Four things are not, and each carries a comment at
the top of its file explaining why it is written the way it is.

**Capacity is per leg, not per departure.** A 16-seat departure can carry far
more than 16 bookings, as long as no single stretch between two stops exceeds
16. The check and the insert are one locking Postgres function — a read-then-
write in TypeScript is a race that oversells seats. `lib/booking/capacity.ts`
exists for display only and says so in its first paragraph.

**Holds expire in an hour, without a cron.** Every capacity query excludes
expired holds inline, so a seat frees itself the instant its hold lapses.
Correctness never depends on a background job.

**Fares are operator-defined, in two modes.** `matrix` is the default and the
one these businesses actually use: a through fare is priced explicitly and is
*not* the sum of its legs. Directional fares are independent, because a route
runs one way and the return trip is a different route.

**Money is integer cents and time is Ontario time.** No floats anywhere. A
departure is a `service_date` plus a `departure_time` in America/Toronto, and
the instant is derived — a 5:00 AM departure is 5:00 AM local on both sides of
the DST change.

---

## Not in the MVP

Maps or geocoding of any kind, GPS tracking, in-app payments, door-to-door
pickup, private vehicle bookings, SMS, a matching algorithm, driver-posted
rides, and multi-operator connecting trips.

Payment happens off-platform, after the trip, between the passenger and the
driver. No money moves through Corridor.

Ontario licensing and commercial passenger insurance are the operators'
responsibility, not the platform's.
