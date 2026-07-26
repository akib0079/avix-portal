/**
 * Minimal timezone math without a tz library (date-fns v4 only, no -tz addon).
 * Uses Intl to read a zone's UTC offset at a given instant, which is enough to
 * convert a wall-clock time in a zone to a real UTC instant (DST-correct).
 */

/** UTC offset of `tz` at instant `date`, in minutes (e.g. -240 for EDT). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  // Format the instant as if it were in the zone, then diff against the same
  // fields read as UTC. The gap is the zone's offset at that instant.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Intl renders 24:00 for midnight in some engines; normalise to 0.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUTC - date.getTime()) / 60_000);
}

/**
 * The UTC instant for a wall-clock time (y/m/d h:m) in `tz`. Resolves DST by
 * computing the offset twice (offsets can differ across a transition boundary).
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset1 = tzOffsetMinutes(new Date(guess), tz);
  const utc1 = guess - offset1 * 60_000;
  const offset2 = tzOffsetMinutes(new Date(utc1), tz);
  const utc2 = guess - offset2 * 60_000;
  return new Date(utc2);
}

/** The y/m/d/weekday for an instant as seen in `tz`. */
export function zonedDateParts(date: Date, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday as string] ?? 0,
  };
}
