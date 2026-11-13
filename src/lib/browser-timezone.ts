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

/** Where TimezoneSync remembers, in this browser, the zone it last sent. */
export function timezoneMarkerKey(userId: string): string {
  return `avix:tz:${userId}`;
}

/**
 * How long a sent zone is trusted before it is sent again. The route only
 * fills an empty zone, so a resend is a no-op unless the zone was cleared
 * since (by the client or an admin); then it is refilled, as it was when the
 * layout read the stored zone on every render.
 */
export const TIMEZONE_RESEND_MS = 24 * 60 * 60 * 1000;

export function timezoneMarker(tz: string, now: number): string {
  return `${tz}|${now}`;
}

/** Whether this browser sent this zone recently enough to skip the request. */
export function timezoneRecentlySent(marker: string | null, tz: string, now: number): boolean {
  if (!marker) return false;
  const bar = marker.lastIndexOf("|");
  if (bar < 0) return false;
  const at = Number(marker.slice(bar + 1));
  if (marker.slice(0, bar) !== tz || !Number.isFinite(at)) return false;
  const age = now - at;
  return age >= 0 && age < TIMEZONE_RESEND_MS;
}
