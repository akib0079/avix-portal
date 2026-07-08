/**
 * The public base URL of the portal, used in emails and notification links.
 * Falls back to the production domain (never localhost) so emails are always
 * correct even if the build/runtime env var is missing on the host.
 */
export function appUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "https://admin.avixdigital.com";
  return url.replace(/\/+$/, "");
}
