# Corridor

A booking platform for the intercity rideshare operators that run fixed daily
timetables between Ontario cities. One passenger site: search a city pair and
a date, see every operator's departures side by side, and request a seat.

A passenger chooses a **company** and a **departure time**. Who drives, and
which vehicle turns up, is the operator's decision and is never shown. Closer
to booking a bus than hailing a car.

**Live demo:** [corridor-cyan.vercel.app](https://corridor-cyan.vercel.app)

Operators set their own fares and run their own vehicles. Corridor is the
shared booking desk: the operator approves each request, and the passenger
pays the driver on the day, in cash or by e-transfer. Nothing is charged in
the app.

Design and rationale: [`docs/architecture.md`](docs/architecture.md).

---

## How a trip works

1. **Search.** Two cities and a date. Every operator running that day is listed together.
2. **Request a seat.** Pick a departure and a pickup point. The request holds the seat for up to an hour while the operator confirms it.
3. **Pay the driver.** Cash or e-transfer after the trip, at the price quoted when the seat was requested.

Someone running a rideshare business applies from the site, is vetted by a
platform admin, and then publishes stops, fares, and a timetable. Passengers
only see operators that have been approved.

---

## What it includes

| Area | What it covers |
|---|---|
| **Operator setup** | Stops, routes in each direction, a timetable, a fleet, and a team. Two fare modes: a price on every city pair, or a price per leg that adds up. |
| **The booking** | A one-hour hold, per-leg capacity, approve or decline, and free cancellation by either side. |
| **Departure day** | Assign vehicles, download the driver manifest, mark the trip complete, and settle payment once both sides agree. Ratings run in both directions. |
| **Account types** | One login can be a passenger, a driver, an operator, and an admin. Signing in asks which account to use, and the header can switch without a second sign-in. The choice changes the landing page and the colour. Permission stays with the database. |
| **The local ride** | An in-city drop-off added to a confirmed intercity seat, priced by zone, and approved by a separate operator. |
| **Promotions** | A six-character voucher, a fixed amount or a percentage off, once per passenger, scoped to the operator that issued it. |
| **The rest of the desk** | In-app notifications, trip complaints, product feedback, weekday occupancy for the operator, and subscription tracking for the platform admin. |

Google sign-in is written and switched off at the button until an OAuth client
exists. See [Google sign-in](#google-sign-in). Native mobile apps are not
started; the business logic lives in Postgres so a later app can call it.

Email goes out through [Resend](https://resend.com). On Resend's sandbox
sender a message reaches only the address that opened the Resend account.
`notify()` prints the subject, the body, and any link when a send is refused
or no API key is set, so a sign-in code is readable from the server log.
Verify a domain at [resend.com/domains](https://resend.com/domains) and point
`NOTIFY_FROM_EMAIL` at it to deliver to passengers.

---

## Stack

[Next.js 16](https://nextjs.org) App Router · TypeScript 7 · Tailwind 4 ·
[Supabase](https://supabase.com) (Postgres, Auth, row-level security) ·
[Zod 4](https://zod.dev) · [Vercel](https://vercel.com) · Resend · oxlint

Server Actions and Route Handlers are the backend. Anything that has to be
atomic — taking a seat, applying a voucher, settling a fare — is a Postgres
function. There is no ORM. `proxy.ts` is Next 16's middleware and refreshes
the session on every request.

---

## Run it

Node 22 or newer, and a Supabase project.

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

Every variable is explained in [`.env.example`](.env.example). Three of them
are deliberately left empty, and an empty value is the right value until you
have a reason:

- `NEXT_PUBLIC_SITE_URL` — the app uses the Vercel URL in production and `http://localhost:3000` locally. Setting this to localhost and deploying it makes password-reset links point at the recipient's own machine.
- `ENFORCE_UNIQUE_CONTACT` — one phone number per account, once you no longer need several demo accounts on one number.
- `CRON_SECRET` — required for the [daily job](#the-daily-job). An empty string counts as unset, and the route then answers 404.

### Supabase

1. Create a project at [supabase.com](https://supabase.com). The free tier is enough.
2. From **Project settings → API keys**, copy the project URL (`https://<ref>.supabase.co`, the API URL), the **publishable** key (`sb_publishable_…`, safe in the browser because row-level security is what protects the rows), and the **secret** key (`sb_secret_…`, server-only).
3. Apply the schema:

   ```bash
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```

4. **Authentication → URL Configuration.** Set the Site URL to your deployed origin and allow these redirects:

   ```
   https://<your-app>/auth/callback     http://localhost:3000/auth/callback
   https://<your-app>/auth/confirm      http://localhost:3000/auth/confirm
   ```

   `/auth/callback` receives the PKCE code from Google and from Supabase's own mail. `/auth/confirm` receives the token hash from the reset links this app mints and sends through Resend.

5. **Authentication → Sessions.** Leave the inactivity timeout and the time-box unset. A session lasts until Sign out: the proxy rotates the refresh token on each request, and the cookie is written with a 400-day max-age (`SESSION_COOKIE_OPTIONS` in `lib/supabase/env.ts`).

6. **Authentication → Providers → Email.** Turn **Confirm email** off.

   With it on, a new account has to click a link before it can do anything, and that mail goes through Supabase's shared SMTP, which allows a couple of messages an hour and then returns `email rate limit exceeded`. An unconfirmed address is an acceptable trade here: nothing is prepaid, and an operator approves every booking by hand. If fake signups become a problem, turn confirmation on with Resend as custom SMTP. `node scripts/auth-loop.mjs` checks that confirmation is off.

This project was created with **"automatically expose new tables"** off, so the migrations grant API access explicitly and row-level security then decides the rows. A project created with that setting on still runs; it also has Supabase's default grants underneath. `supabase/tests/grants.test.ts` describes the intended grants either way.

### Google sign-in

The code path is complete. It needs an OAuth client. Google redirects to
**Supabase**, so the redirect URI is a `supabase.co` address.

1. In [Google Cloud](https://console.cloud.google.com), create or pick a project.
2. On the OAuth consent screen (newer consoles: *Google Auth Platform → Branding*), set the user type to **External**, name the app `Corridor`, and add a support email. Authorised domains: `supabase.co`, plus `vercel.app` or your own domain. Leave the default scopes (`email`, `profile`, `openid`). **Publish the app.** While it says *Testing*, only listed test users can sign in, and everyone else sees `access_blocked`.
3. **Credentials → Create credentials → OAuth client ID.** Application type **Web application**. Authorised redirect URI, with no trailing slash:

   ```
   https://<ref>.supabase.co/auth/v1/callback
   ```

   Supabase shows the same string on the Google provider page. Copy the client ID and secret.

4. **Supabase → Authentication → Providers → Google.** Enable it, paste both values, and save.
5. Turn the buttons on: delete `components/google-button.tsx` and the `/google-unavailable` page, and have `sign-in-form.tsx` and `sign-up-form.tsx` post their `next` value to `signInWithGoogle` again. The shape each form replaced is in the file's header comment.
6. `node scripts/auth-loop.mjs` reports whether the provider is live. Then use *Continue with Google* on `/sign-in`.

Until step 5, *Continue with Google* stays greyed out and leads to a page that
points at email and password. `signInWithGoogle` and `/auth/callback` are
already written.

### Becoming a platform admin

`platform_role` is not writable through any policy, and a trigger blocks the
change unless it comes from an existing admin or the service role. The first
admin is granted from the SQL editor, which is exempt:

```sql
update public.profiles set platform_role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

`/admin` then lets you add cities and vet operators. The next sign-in asks
which account to use.

### Demo data

```bash
node scripts/seed.mjs           # wipe and rebuild
node scripts/seed.mjs --remove  # take it back out
```

The seed fills the database `.env.local` points at: cities along the 401,
several operators, routes in both directions, a rolling timetable, and
bookings in every status. Dates are relative to today, so a reseed stays
current.

The operator list and the demo sign-in password are read from `_local` and
are not in this repository. Without those files the script stops and names
the one that is missing.

The data is built to show the awkward cases. One operator sells a through
trip for less than the sum of its legs (matrix pricing). Another sells the
same cities as the sum (additive). One departure is full on its middle leg
while both ends stay open. One city has two stops, so one search offers two
drop-offs at different prices, and one of them carries the airport fee.

### The daily job

`/api/cron` extends the 30-day departure window and relabels lapsed holds.
`vercel.json` schedules it for 08:00 UTC. Set `CRON_SECRET` to a non-empty
value or the route stays shut and logs the reason.

The job is housekeeping. Capacity already ignores an expired hold, so a seat
frees itself whether or not the sweep has run.

### Attack protection

Failed sign-ins are counted in this repo, per account and per caller
(`lib/auth/throttle.ts`: 10 per address and 40 per IP in 15 minutes). Failed
voucher codes are counted per account inside `resolve_voucher()` (10 an hour).
Both live here because sign-in runs in a Server Action: GoTrue would see the
server's address, and every visitor would share one bucket. The stored
subjects are SHA-256 hashes.

For a deployment on the public internet, two Supabase settings sit on top of that:

1. **Cloudflare Turnstile.** Create a widget at [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile), enable **Authentication → Attack Protection → CAPTCHA** with the secret key, and set `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Render the widget on `/sign-in`, `/sign-up`, and `/forgot-password`, and pass the token through:

   ```ts
   await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
   ```

   Once the setting is on, Supabase rejects a call that has no token, so `scripts/auth-loop.mjs` and `scripts/seed.mjs` need a second project or a bypass before you enable it. They sign in directly.

2. **Leaked-password protection.** **Authentication → Attack Protection → Prevent use of leaked passwords.** It checks new passwords against Have I Been Pwned and applies at signup and password change. This is a Pro-plan feature. On the free plan, the common-password list in `lib/auth/password-strength.ts` is a meter, which is a weaker check.

The same screen is where the Auth rate limits and the session time-box live.
This project leaves the time-box unset on purpose. See the session step above.

---

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Development server. |
| `npm run build` | Production build, including a full typecheck. |
| `npm test` | Unit tests and database tests. 323 tests. |
| `npm run test:unit` | Fares, capacity, money, time, account types, ride lists, the seat map, paging, vouchers, insights. |
| `npm run test:db` | The migration files against Postgres. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | oxlint. Why it is not ESLint, and every disabled rule: [`docs/linting.md`](docs/linting.md). |
| `npm run lint:fix` | The same, applying what it can fix. |
| `npm run db:types` | Regenerate `lib/supabase/database.types.ts` from a local Supabase stack. This project does not run one, so the file is updated by hand in the same commit as the migration that changes a table. |
| `node scripts/seed.mjs` | Rebuild the demo data from the local operator research. `--remove` takes it out. |
| `node scripts/e2e-loop.mjs` | Request through settlement, against a running app. |
| `node scripts/operator-loop.mjs` | A new operator from application to a seat on sale, against a running app. |
| `node scripts/incity-loop.mjs` | The local ride: who may book one, who may confirm it, and what cancels it. |
| `node scripts/auth-loop.mjs` | Signup and both recovery paths, against the live database. |
| `node scripts/race-test.mjs` | Several passengers requesting the same departure at once, against the live database. |

### Database tests

`npm run test:db` applies the migration files to [PGlite](https://pglite.dev),
Postgres compiled to WebAssembly, with a small stand-in for Supabase's `auth`
schema. No Docker.

`request_booking()` under test is the function that runs in production. Each
call uses its own transaction, with `set local role` and the JWT claims
PostgREST would set, so row-level security behaves as it does live. The
harness grants only what the migrations grant. The suite is what caught a
privilege escalation that let any signed-in user grant themselves platform
admin.

### The race test

`scripts/race-test.mjs` fires concurrent requests at a live database, each on
its own connection, which is the pressure the row lock in `request_booking()`
exists for. PGlite has a single connection, so it cannot do this.

The test checks both directions. Contended seats are refused. Passengers on
legs that do not overlap all succeed, including on a one-seat departure. A
lock held across the whole departure would pass the oversell check and still
be wrong: a van that can carry a full load on each leg would be limited to
one load for the whole route.

---

## Where things are

```
app/
  (public)/      search, departure detail, operator profiles, for operators,
                 sign in and up, the account picker, recovery
  (passenger)/   my rides and history, booking detail, the local ride,
                 notifications, profile, reports, feedback
  (operator)/    setup, requests and history, departures, fleet, team, zones,
                 in-city requests, insights, promotions, complaints, billing
  (driver)/      trips, the manifest, flagging and rating a passenger
  (admin)/       operator vetting, cities, subscriptions, complaints, feedback
  api/           the manifest CSV, the daily job
  auth/          callback (PKCE) and confirm (token hash)
components/      UI primitives, icons, the header and account switcher,
                 the seat map, list controls
lib/
  auth/          session, account types, sign-in, recovery, password strength
  booking/       fares, capacity, the seat map, ride lists, search,
                 booking and departure-day actions
  incity/        the local ride, imported by nothing on the intercity path
  notifications/ the in-app list
  operator/      setup, insights, dashboard queries, paging through GoTrue
  promotions/    voucher codes
  reports/       complaints and feedback
  supabase/      clients, types, and rows() / one() / count()
  validation/    Zod schemas
  notify.ts      the one place a notification is sent
  routes.ts      the only typedRoutes escape hatches
proxy.ts         refreshes the session on every request
supabase/
  migrations/    numbered SQL: schema, policies, and every Postgres function
  functions/     an index of which migration defines each function
  tests/         the migrations, run against Postgres
scripts/         the seed, and the loops that run against a real database
```

Three boundaries are load-bearing:

- **`lib/booking/fares.ts` is the only module that reads `pricing_mode`.** Nothing else decides what a segment costs.
- **`lib/incity` stays isolated.** The intercity path does not import it, so the local ride can be removed without touching booking. The booking page links to the ride.
- **Reads go through `rows()`, `one()`, or `count()`.** A bare `const { data }` followed by `data ?? []` renders a refused query as an empty page. `lib/supabase/read-paths.test.ts` fails if one comes back.

Postgres functions live in `supabase/migrations/`, because a function is
schema and has to replay onto a fresh database.
[`supabase/functions/README.md`](supabase/functions/README.md) indexes which
migration defines each one.

---

## Where it breaks

Most of the app is ordinary CRUD. Four things are not, and each file says so
at the top.

**Capacity is per leg.** A 16-seat departure can hold more than 16 bookings,
as long as no single stretch between two stops exceeds 16. Windsor to London
and London to Toronto can share one physical seat. The check and the insert
are one locking function, `request_booking()`. A read-then-write in TypeScript
oversells seats. `lib/booking/capacity.ts` is for display only.

**Holds expire in an hour, with no cron.** `hold_expires_at` is the earlier of
one hour out and the departure itself. Every capacity query ignores a hold
whose time has passed, so the seat frees itself at that instant. A later job
may relabel the row for display. Correctness does not depend on it.

**Fares come in two modes, and the operator picks.** `matrix` is the default,
and the one these businesses use: Windsor to Toronto has its own price, which
is lower than the legs added together. `additive` sums the legs a segment
spans. The return trip is a separate route with its own prices. The fare is
recomputed on the server when the seat is requested and stored on the booking.
A price sent by the browser is ignored. A voucher is the one adjustment after
that, and a wrong or spent code refuses the booking.

**Money is integer cents, and time is Ontario time.** `4500` is $45.00. A
departure is a service date plus a clock time in `America/Toronto`, and the
instant is derived with `toronto_instant()`. A 5:00 AM departure is 5:00 AM
local on both sides of the daylight-saving change.

---

## Outside the product

Maps and geocoding, GPS tracking, in-app payments, door-to-door pickup,
private vehicle bookings, SMS, a matching algorithm, driver-posted rides, and
trips that connect across operators.

Ontario licensing and commercial passenger insurance sit with the operators.

---

## Read next

- [`docs/architecture.md`](docs/architecture.md) — the model, the invariants, and the mistakes this codebase has already made once.
- [`supabase/functions/README.md`](supabase/functions/README.md) — which migration defines each Postgres function.
- [`docs/linting.md`](docs/linting.md) — oxlint, and every disabled rule.
