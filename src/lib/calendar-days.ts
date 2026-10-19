/**
 * Calendar days as "YYYY-MM-DD" strings, and instants placed on them in a
 * named timezone.
 *
 * Every grid and lane on the calendar is built from these, never from
 * `new Date()` arithmetic in whatever zone the code happens to run in. The
 * page renders first on a UTC host and then in the admin's browser; with
 * day keys computed in one explicit zone, both renders put a 23:30 call on
 * the same day, and hydration has nothing to disagree about.
 *
 * Dependency-free so the server page and the client view share it.
 */

export type DayKey = string; // "YYYY-MM-DD"

function parts(key: DayKey): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y!, m!, d!];
}

/** Whole calendar days, tz-independent. */
export function addDays(key: DayKey, n: number): DayKey {
  const [y, m, d] = parts(key);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayMon(key: DayKey): number {
  const [y, m, d] = parts(key);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing `key`. */
export function mondayOf(key: DayKey): DayKey {
  return addDays(key, -weekdayMon(key));
}

/** Day number within its month. */
export function dayOfMonth(key: DayKey): number {
  return parts(key)[2];
}

/** The day an instant falls on, in `tz`. Falls back to UTC for a bad zone. */
export function dayIn(iso: string | Date, tz: string): DayKey {
  const at = typeof iso === "string" ? new Date(iso) : iso;
  try {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Format a day key without a zone shift (it names a date, not an instant). */
export function formatDay(key: DayKey, options: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = parts(key);
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** An instant as wall-clock text in `tz`. */
export function formatIn(
  iso: string,
  tz: string,
  options: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: tz }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
      new Date(iso),
    );
  }
}
