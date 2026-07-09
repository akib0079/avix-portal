/**
 * The public base URL of the portal, used in emails and notification links.
 *
 * IMPORTANT: this is only ever called server-side (emails, auth, server
 * actions), so it deliberately does NOT read `NEXT_PUBLIC_APP_URL`.
 * `NEXT_PUBLIC_*` values are inlined into the bundle at BUILD time — building
 * locally (where that var is http://localhost:3000) would freeze localhost
 * into every email link. `BETTER_AUTH_URL` is a normal server var read at
 * RUNTIME from the host's env, and the hard fallback guarantees the production
 * domain (never localhost) even if it is missing.
 */
export function appUrl(): string {
  const url = process.env.BETTER_AUTH_URL || "https://admin.avixdigital.com";
  return url.replace(/\/+$/, "");
}
