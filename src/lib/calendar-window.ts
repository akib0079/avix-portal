import { addDays, dayIn, mondayOf, type DayKey } from "@/lib/calendar-days";

/**
 * Which week and month the admin calendar shows, and the meetings window it
 * fetches. Dependency-free so the page and its tests share it.
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export type CalendarParams = { month?: string; week?: string };

export type CalendarRange = {
  weekKey: DayKey;
  monthKey: string;
  /** The meetings fetch bounds, from inclusive, to exclusive. */
  from: Date;
  to: Date;
};

/** UTC midnight of a day key — a fetch bound, padded either side by the caller. */
function startOf(key: DayKey): Date {
  return new Date(`${key}T00:00:00Z`);
}

/** The view for `todayKey`, "today" in the agency's zone. */
export function calendarRange(params: CalendarParams, todayKey: DayKey): CalendarRange {
  const { month, week } = params;
  // Week mode follows ?week=, month mode ?month=; each derives the other so
  // switching views keeps you in the same place.
  let weekKey: DayKey;
  let monthKey: string;
  if (week && DAY_RE.test(week)) {
    weekKey = mondayOf(week);
    monthKey = addDays(weekKey, 3).slice(0, 7); // the month most of the week is in
  } else if (month && MONTH_RE.test(month)) {
    monthKey = month;
    weekKey = mondayOf(todayKey.slice(0, 7) === month ? todayKey : `${month}-01`);
  } else {
    monthKey = todayKey.slice(0, 7);
    weekKey = mondayOf(todayKey);
  }

  // One fetch covers the month grid and the week, padded two days each side
  // so a meeting near midnight still lands on its day in any viewer's zone.
  const gridStart = mondayOf(`${monthKey}-01`);
  const gridEnd = addDays(gridStart, 42);
  const weekEnd = addDays(weekKey, 7);
  const from = startOf(addDays(weekKey < gridStart ? weekKey : gridStart, -2));
  const to = startOf(addDays(weekEnd > gridEnd ? weekEnd : gridEnd, 2));
  return { weekKey, monthKey, from, to };
}

/**
 * A meetings window that covers {@link calendarRange} in every zone, known
 * before the agency zone is read. "Today" anywhere is the UTC day or one
 * either side of it, so the union of those three views always holds the real
 * one, and the meetings read can run beside the zone read instead of after
 * it. The page then trims the rows to the real view's bounds.
 */
export function fetchWindow(params: CalendarParams, now: Date): { from: Date; to: Date } {
  const utcToday = dayIn(now, "UTC");
  const ranges = [-1, 0, 1].map((n) => calendarRange(params, addDays(utcToday, n)));
  return {
    from: new Date(Math.min(...ranges.map((r) => r.from.getTime()))),
    to: new Date(Math.max(...ranges.map((r) => r.to.getTime()))),
  };
}
