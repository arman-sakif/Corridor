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

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
}
