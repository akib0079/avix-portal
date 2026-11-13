const PRODUCTION_URL = "https://admin.avixdigital.com";

/**
 * Whether a hostname can only be a developer's machine or a private network:
 * loopback, 0.0.0.0, *.localhost / *.local / *.test, and the private and
 * link-local IPv4 ranges (a LAN address, used to try the app on a phone).
 * Takes a URL's `hostname`, so IPv6 arrives bracketed ("[::1]").
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host === "0.0.0.0" || host === "[::1]" || host === "::1") return true;
  if (/\.(localhost|local|test)$/.test(host)) return true;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/**
 * Whether an app URL belongs to a local process rather than a deployment:
 * a local host, or plain http (every deployment serves https). A blank URL is
 * not local — the deployed app falls back to production when it is unset.
 * The email guard and appUrl() both decide by this, so "don't send from here"
 * and "point links at production" can never disagree.
 */
export function isLocalAppUrl(url: string): boolean {
  if (!url) return false;
  if (!/^https:\/\//i.test(url)) return true;
  try {
    return isLocalHost(new URL(url).hostname);
  } catch {
    return true;
  }
}

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
  const url = process.env.BETTER_AUTH_URL || "";
  // Never let a localhost/dev value leak into emails or notifications —
  // a reset link sent from a dev machine must still point at production.
  if (!url || isLocalAppUrl(url)) return PRODUCTION_URL;
  return url.replace(/\/+$/, "");
}
