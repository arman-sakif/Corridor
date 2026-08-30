/** Environment access, in one place, so a missing key fails loudly and early. */

/**
 * Supabase renamed its API keys: `anon` became the **publishable** key and
 * `service_role` became the **secret** key. The names below match what the
 * dashboard shows today, and the old names are still accepted so an older
 * deployment or a snippet copied from older docs keeps working.
 *
 * Whatever they are called, the split is the same one: the publishable key is
 * safe in the browser and RLS is what protects the data behind it; the secret
 * key bypasses RLS entirely and must never reach the client bundle.
 */

function required(names: string[], value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${names[0]}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required(['NEXT_PUBLIC_SUPABASE_URL'], process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/** The publishable key. Goes to the browser; RLS does the protecting. */
export function supabaseAnonKey(): string {
  return required(
    ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * The secret key. Server-only — it bypasses RLS, so every call site has to do
 * its own authorisation first. Importing this from a client component is a
 * build error, because the modules that use it are marked `server-only`.
 */
export function supabaseServiceRoleKey(): string {
  return required(
    ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/**
 * The absolute origin, used for OAuth redirects and links in email.
 *
 * Getting this wrong fails quietly and confusingly: a deployed app that still
 * thinks it is on localhost sends people a confirmation link to their own
 * machine. So rather than defaulting straight to localhost, fall back to the
 * URL Vercel injects — the production domain when there is one, the
 * per-deployment URL on a preview.
 *
 * `NEXT_PUBLIC_SITE_URL` still wins when set, which is what you want for a
 * custom domain.
 */
export function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost}`;

  return 'http://localhost:3000';
}

/**
 * Whether to refuse a phone number that is already on another profile.
 *
 * Off by default, and deliberately so while the platform is being built: the
 * only people making accounts right now are us, and we make several a day
 * against the same phone and the same inbox. Turning the rule on before that
 * stops would only mean disabling it again to test anything.
 *
 * The check itself lives in `lib/auth/contact-uniqueness.ts` and is written,
 * wired in, and tested — this switch is the whole difference between advisory
 * and enforced. Set `ENFORCE_UNIQUE_CONTACT=1` when the demo accounts are gone.
 */
export function enforceUniqueContact(): boolean {
  const value = process.env.ENFORCE_UNIQUE_CONTACT;
  return value === '1' || value === 'true';
}


/**
 * How long the session cookie is allowed to live in the browser.
 *
 * Supabase rotates the refresh token on every request the proxy makes, so the
 * session itself never has to end. What ends it is the cookie disappearing —
 * and a cookie written with no max-age is a session cookie, gone the moment
 * the browser closes. That is the whole of 'why am I signed out again'.
 *
 * 400 days is the ceiling Chrome enforces on any cookie; asking for more just
 * gets it clamped.
 */
export const SESSION_COOKIE_OPTIONS = {
  maxAge: 400 * 24 * 60 * 60,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;
