/**
 * The zone a client's browser reports (TimezoneSync, src/app/api/me/timezone),
 * checked before it is stored: a real IANA zone this runtime knows, or null.
 */
export function parseBrowserTimezone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const tz = input.trim();
  if (!tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}
