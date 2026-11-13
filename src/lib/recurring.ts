/**
 * The calendar of a recurring plan (a Retainer): when its invoices come due,
 * which period each one is for, and the words for both.
 *
 * Everything here works on calendar days ("YYYY-MM-DD") in the agency's time
 * zone, never on the server's clock. The old retainer duty read getDate() and
 * getMonth() in server time, which is UTC in production while the agency is
 * not, so a plan "on the 1st" drafted its invoice on the wrong day for hours
 * at a time. A run is due at RUN_HOUR on its day, agency time; nextRunAt
 * stores that instant, so a DST change can't move a plan off its hour.
 *
 * Monthly plans keep their day of the month (`dayOfMonth`) as an anchor: a
 * plan on the 31st bills on 28 February and is back on the 31st in March,
 * instead of drifting to the 28th for good.
 *
 * Dependency-free so the duty, the actions, the forms' previews and the tests
 * all read the same calendar.
 */
import { zonedDateParts, zonedWallTimeToUtc } from "@/lib/tz";
import { usdValue, type UsdSource } from "@/lib/invoice-usd";

export type ScheduleUnit = "WEEK" | "MONTH";

export type Cadence = { frequency: ScheduleUnit; interval: number };

/** A cadence with its monthly anchor: the day of the month it bills on. */
export type Schedule = Cadence & { dayOfMonth: number };

/** A calendar day, "YYYY-MM-DD". */
export type Day = string;

/**
 * The hour, agency time, a run comes due: drafts are waiting when the working
 * day starts, and an invoice that sends itself doesn't arrive at midnight.
 */
export const RUN_HOUR = 6;

/** Missed periods drafted in one pass; the next pass carries on. */
export const MAX_RUNS_PER_PASS = 3;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDay(value: string): boolean {
  const match = DAY_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function parts(day: Day): { y: number; m: number; d: number } {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}

function format(y: number, m: number, d: number): Day {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Days in a month, month 1-12. */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(day: Day, days: number): Day {
  const { y, m, d } = parts(day);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return format(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * `months` later (or earlier), on `anchorDay`, or on the month's last day
 * when it is shorter: the 31st becomes 28 February, then the 31st again.
 */
export function addMonths(day: Day, months: number, anchorDay = parts(day).d): Day {
  const { y, m } = parts(day);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return format(year, month, Math.min(anchorDay, daysInMonth(year, month)));
}

/** Whole months from one period's month to another's ("2026-11" → "2027-01" is 2). */
export function monthsBetween(from: string, to: string): number {
  const a = parts(`${from.slice(0, 7)}-01`);
  const b = parts(`${to.slice(0, 7)}-01`);
  return (b.y - a.y) * 12 + (b.m - a.m);
}

/** The calendar day an instant falls on in a time zone. */
export function dayIn(instant: Date, timeZone: string): Day {
  try {
    const { year, month, day } = zonedDateParts(instant, timeZone);
    return format(year, month, day);
  } catch {
    // An unknown zone in settings must not stop invoicing.
    return instant.toISOString().slice(0, 10);
  }
}

/** The instant a run on `day` comes due: RUN_HOUR, agency time. */
export function runInstant(day: Day, timeZone: string): Date {
  const { y, m, d } = parts(day);
  try {
    return zonedWallTimeToUtc(y, m, d, RUN_HOUR, 0, timeZone);
  } catch {
    return new Date(Date.UTC(y, m - 1, d, RUN_HOUR));
  }
}

/** A plain calendar date as stored in a timestamp column: UTC midnight. */
export function dayToDate(day: Day): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function dateToDay(date: Date): Day {
  return date.toISOString().slice(0, 10);
}

/** ISO 8601 week: weeks start on Monday, and week 1 holds the year's first Thursday. */
export function isoWeek(day: Day): { year: number; week: number } {
  const { y, m, d } = parts(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.getUTCDay() || 7;
  // The Thursday of this week decides the year it belongs to.
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

function mondayOf(day: Day): Day {
  const { y, m, d } = parts(day);
  return addDays(day, 1 - (new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7));
}

/**
 * Days from one week to another, in whole weeks: `from` is a week's period
 * key ("2026-W45") or any day in it. How far a weekly plan's template dates
 * move for a run on `to`.
 */
export function daysBetweenWeeks(from: string, to: Day): number {
  const key = /^(\d{4})-W(\d{2})$/.exec(from);
  // Week 1 is the week of 4 January.
  const start = key ? addDays(mondayOf(`${key[1]}-01-04`), 7 * (Number(key[2]) - 1)) : mondayOf(from);
  return Math.round((dayToDate(mondayOf(to)).getTime() - dayToDate(start).getTime()) / 86_400_000);
}

/**
 * Which period a run on `day` bills: its month ("2026-11") for a monthly
 * plan, its ISO week ("2026-W45") for a weekly one. Invoice.retainerPeriod
 * stores it and is unique per plan, so no period is ever invoiced twice. Keys
 * of one kind sort in calendar order as plain strings.
 */
export function periodKey(day: Day, unit: ScheduleUnit): string {
  if (unit === "MONTH") return day.slice(0, 7);
  const { year, week } = isoWeek(day);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The run after the one on `day`. */
export function nextRunDay(day: Day, schedule: Schedule): Day {
  return schedule.frequency === "MONTH"
    ? addMonths(day, schedule.interval, schedule.dayOfMonth)
    : addDays(day, 7 * schedule.interval);
}

/** The run before the one on `day`. */
export function previousRunDay(day: Day, schedule: Schedule): Day {
  return schedule.frequency === "MONTH"
    ? addMonths(day, -schedule.interval, schedule.dayOfMonth)
    : addDays(day, -7 * schedule.interval);
}

/** Where a run claimed at `seen` moves nextRunAt to. */
export function advanceRun(seen: Date, schedule: Schedule, timeZone: string): Date {
  return runInstant(nextRunDay(dayIn(seen, timeZone), schedule), timeZone);
}

/** The first run on or after `from`, walking the schedule on from `day`. */
export function rollForward(day: Day, schedule: Schedule, from: Day): Day {
  let run = day;
  // Bounded: a weekly plan years behind still settles in a few hundred steps.
  for (let i = 0; run < from && i < 2000; i++) run = nextRunDay(run, schedule);
  return run;
}

/** Where a plan stops: after so many invoices, or after a date. */
export type PlanEnd = {
  endAfterCount: number | null;
  endDay: Day | null;
  /** Invoices the plan has made so far. */
  runCount: number;
};

/** Whether a plan that has made `end.runCount` invoices may make one on `day`. */
export function runAllowed(day: Day, end: PlanEnd): boolean {
  if (end.endAfterCount != null && end.runCount >= end.endAfterCount) return false;
  if (end.endDay != null && day > end.endDay) return false;
  return true;
}

/** The next `count` runs from `start` (included), stopping where the plan ends. */
export function upcomingRuns(start: Day, schedule: Schedule, end: PlanEnd, count: number): Day[] {
  const runs: Day[] = [];
  let day = start;
  let made = end.runCount;
  while (runs.length < count && runAllowed(day, { ...end, runCount: made })) {
    runs.push(day);
    made++;
    day = nextRunDay(day, schedule);
  }
  return runs;
}

/** Invoices still to come, or null when the plan never ends. */
export function remainingRuns(start: Day | null, schedule: Schedule, end: PlanEnd): number | null {
  if (end.endAfterCount == null && end.endDay == null) return null;
  if (start == null) return 0;
  const byCount = end.endAfterCount == null ? Infinity : Math.max(end.endAfterCount - end.runCount, 0);
  if (end.endDay == null) return byCount;
  // Counted by walking, capped well past any sensible plan.
  return upcomingRuns(start, schedule, end, Math.min(byCount, 1000)).length;
}

/**
 * When the pre-v49 code made the invoices it stamped `period` ("2026-11"): it
 * took the month from the server's own clock (getMonth), not UTC, so its
 * month runs from local midnight on the 1st. This build runs on the same
 * server, so its local time is the old one's.
 */
export function legacyMonthWindow(period: string): { gte: Date; lt: Date } {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  return { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
}

/**
 * Where a plan made before schedules existed (no nextRunAt) picks up: its
 * bill day in the month after the last one it drafted, but never before the
 * current month. Months it missed while the old code was in charge stay
 * missed, rather than turning up as backdated drafts on the day this ships.
 */
export function legacyNextRunDay(
  plan: { dayOfMonth: number; lastGeneratedPeriod: string | null },
  today: Day,
): Day {
  const thisMonth = today.slice(0, 7);
  const after =
    plan.lastGeneratedPeriod && /^\d{4}-\d{2}$/.test(plan.lastGeneratedPeriod)
      ? addMonths(`${plan.lastGeneratedPeriod}-01`, 1).slice(0, 7)
      : thisMonth;
  const month = after > thisMonth ? after : thisMonth;
  return addMonths(`${month}-01`, 0, Math.min(Math.max(plan.dayOfMonth, 1), 31));
}

/**
 * The first invoice of a plan made from an existing invoice: one period
 * after that invoice, moved on to today or later, so an old invoice made
 * recurring doesn't start by drafting the months since it was issued.
 */
export function defaultFirstRun(issueDay: Day, cadence: Cadence, today: Day): Day {
  const schedule = { ...cadence, dayOfMonth: parts(issueDay).d };
  return rollForward(nextRunDay(issueDay, schedule), schedule, today);
}

/** The day of the month a plan whose next invoice is on `day` keeps billing on. */
export function anchorDay(day: Day): number {
  return parts(day).d;
}

/** What a plan row says about its schedule, as stored. */
export type PlanFacts = Schedule & {
  active: boolean;
  nextRunAt: Date | null;
  endAfterCount: number | null;
  endDate: Date | null;
  runCount: number;
  lastGeneratedPeriod: string | null;
};

export type PlanState = "active" | "paused" | "ended";

export function planEnd(plan: {
  endAfterCount: number | null;
  endDate: Date | null;
  runCount: number;
}): PlanEnd {
  return {
    endAfterCount: plan.endAfterCount,
    endDay: plan.endDate ? dateToDay(plan.endDate) : null,
    runCount: plan.runCount,
  };
}

/**
 * Paused keeps its next run; ended has none left. A plan from before
 * schedules has no end and no nextRunAt, so it reads as paused, never ended.
 */
export function planState(plan: {
  active: boolean;
  nextRunAt: Date | null;
  endAfterCount: number | null;
  endDate: Date | null;
}): PlanState {
  if (plan.active) return "active";
  return plan.nextRunAt == null && (plan.endAfterCount != null || plan.endDate != null)
    ? "ended"
    : "paused";
}

export type PlanSummary = {
  state: PlanState;
  cadence: string;
  /** The next run's day, agency time: stored, or where an older plan picks up. */
  nextDay: Day | null;
  /** Its time has come and no run has drafted it yet. */
  due: boolean;
  /** The next few runs, nextDay first. */
  upcoming: Day[];
  /** Invoices still to come, or null when the plan never ends. */
  remaining: number | null;
};

/** Everything a page says about a plan's schedule, from the stored row. */
export function planSummary(plan: PlanFacts, timeZone: string, now: Date): PlanSummary {
  const state = planState(plan);
  const end = planEnd(plan);
  const nextDay =
    state === "ended"
      ? null
      : plan.nextRunAt
        ? dayIn(plan.nextRunAt, timeZone)
        : legacyNextRunDay(plan, dayIn(now, timeZone));
  const due =
    state === "active" &&
    nextDay != null &&
    (plan.nextRunAt ?? runInstant(nextDay, timeZone)).getTime() <= now.getTime();
  return {
    state,
    cadence: cadenceLabel(plan),
    nextDay,
    due,
    upcoming: nextDay ? upcomingRuns(nextDay, plan, end, 3) : [],
    remaining: state === "ended" ? 0 : remainingRuns(nextDay, plan, end),
  };
}

/** A schedule as the forms send it (lib/validation/retainer scheduleSchema). */
export type ScheduleFormValue = Cadence & {
  nextDate: Day;
  ends: "never" | "after" | "on";
  endAfterCount?: number | null;
  endDate?: string;
  autoSend: boolean;
};

/**
 * The plan columns a schedule writes. A monthly plan bills on its next
 * date's day from then on, unless that date is the one it already had
 * (`keepDayOfMonth`): a plan on the 31st whose next run is 28 February keeps
 * the 31st.
 */
export function scheduleColumns(
  schedule: ScheduleFormValue,
  timeZone: string,
  keepDayOfMonth?: number,
) {
  return {
    frequency: schedule.frequency,
    interval: schedule.interval,
    dayOfMonth: keepDayOfMonth ?? anchorDay(schedule.nextDate),
    nextRunAt: runInstant(schedule.nextDate, timeZone),
    endAfterCount: schedule.ends === "after" ? (schedule.endAfterCount ?? null) : null,
    endDate: schedule.ends === "on" && schedule.endDate ? dayToDate(schedule.endDate) : null,
    autoSend: schedule.autoSend,
  };
}

/**
 * What's wrong with a schedule, given where its plan stands: a next date in
 * the past (unless it is the one already stored, on a plan running behind),
 * a first invoice inside the period its first invoice already covers, or an
 * end the plan has already passed. Null when it is fine.
 */
export function scheduleProblem(
  schedule: ScheduleFormValue,
  ctx: { today: Day; runCount: number; storedDay?: Day | null; coveredPeriod?: string },
): string | null {
  if (schedule.nextDate < ctx.today && schedule.nextDate !== ctx.storedDay) {
    return "Pick today or a later date for the next invoice.";
  }
  const unit = schedule.frequency === "WEEK" ? "week" : "month";
  if (ctx.coveredPeriod && periodKey(schedule.nextDate, schedule.frequency) <= ctx.coveredPeriod) {
    return `This invoice already covers that ${unit}. Start the plan in a later ${unit}.`;
  }
  const end: PlanEnd = {
    endAfterCount: schedule.ends === "after" ? (schedule.endAfterCount ?? null) : null,
    endDay: schedule.ends === "on" ? schedule.endDate || null : null,
    runCount: ctx.runCount,
  };
  if (!runAllowed(schedule.nextDate, end)) {
    return schedule.ends === "after"
      ? `This plan has made ${ctx.runCount} invoice${ctx.runCount === 1 ? "" : "s"} already. Pick a number above ${ctx.runCount}.`
      : "The end date is before the next invoice.";
  }
  return null;
}

// ---------------------------------------------------------------- words

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const SHORT_MONTHS = MONTHS.map((name) => name.slice(0, 3));

/** "1 Dec" */
export function shortDay(day: Day): string {
  const { m, d } = parts(day);
  return `${d} ${SHORT_MONTHS[m - 1]}`;
}

/** "1 Dec 2026" */
export function longDay(day: Day): string {
  return `${shortDay(day)} ${parts(day).y}`;
}

/** What a period's merge tags read: {{period}}, {{month}} and so on. */
export type PeriodVars = {
  period: string;
  month: string;
  year: string;
  periodStart: string;
  periodEnd: string;
};

/**
 * The words for the period a run on `day` bills, which lasts until the day
 * before the next run. {{period}} is the month for a monthly plan
 * ("November 2026", whatever day it bills on, as retainer invoices have
 * always been titled), the months covered for a longer one ("Nov 2026 – Jan
 * 2027"), and the dates for a weekly one ("2 – 8 Nov 2026").
 */
export function periodVars(day: Day, schedule: Schedule): PeriodVars {
  const start = parts(day);
  const lastDay = addDays(nextRunDay(day, schedule), -1);
  const end = parts(lastDay);
  let period: string;
  if (schedule.frequency === "MONTH") {
    const last = parts(addMonths(`${day.slice(0, 7)}-01`, schedule.interval - 1));
    period =
      schedule.interval === 1
        ? `${MONTHS[start.m - 1]} ${start.y}`
        : `${SHORT_MONTHS[start.m - 1]} ${start.y} – ${SHORT_MONTHS[last.m - 1]} ${last.y}`;
  } else if (start.y === end.y && start.m === end.m) {
    period = `${start.d} – ${longDay(lastDay)}`;
  } else if (start.y === end.y) {
    period = `${shortDay(day)} – ${longDay(lastDay)}`;
  } else {
    period = `${longDay(day)} – ${longDay(lastDay)}`;
  }
  return {
    period,
    month: MONTHS[start.m - 1],
    year: String(start.y),
    periodStart: longDay(day),
    periodEnd: longDay(lastDay),
  };
}

// "May" is left out of standalone names: on its own it is usually the verb.
const STANDALONE: readonly string[] = MONTHS.filter((name) => name !== "May");
const MONTH_NAME = [...MONTHS, "Sept", ...SHORT_MONTHS].join("|");
// 1 to 31 only, so "Sprint 42 November" is a month mention, not a day.
const DAY_NUM = String.raw`(?:3[01]|[12]\d|0?[1-9])(?:st|nd|rd|th)?(?!\d)`;
// "31st of December"; only after an ordinal, since "5 of May" is rarely a date.
const DAY_OF = String.raw`(?<=st|nd|rd|th)\s+of`;
const DAY_SEP = String.raw`\s*[–—-]\s*`;
const YEAR_AFTER = String.raw`,?\s+\d{4}(?!\d)`;
/**
 * A month as a template writes it, with the days and year around it:
 * "1 Jan 2027", "2 – 8 Nov 2026", "15th of December" (day first), or
 * "December 1–31, 2026", "Nov. 2026", "November" (month first).
 */
const MONTH_DATE = new RegExp(
  String.raw`\b(?<d1>${DAY_NUM})(?:(?<sep>${DAY_SEP})(?<d2>${DAY_NUM}))?(?<of>${DAY_OF})?\s+(?<name>${MONTH_NAME})(?<dot>\.?)(?![A-Za-z])(?<year>${YEAR_AFTER})?` +
    "|" +
    String.raw`\b(?<uName>${MONTH_NAME})(?<uDot>\.?)(?![A-Za-z])(?:\s+(?<ud1>${DAY_NUM})(?:(?<uSep>${DAY_SEP})(?<ud2>${DAY_NUM}))?)?(?<uYear>${YEAR_AFTER})?`,
  "g",
);
/** What joins two months into one span: "Oct–Dec 2026", "May to June 2026". */
const MONTH_JOIN = /^(?:\s*[–—/-]\s*|\s+to\s+)$/;
/** A year for the arithmetic of a date written without one, and no template to go by. */
const NO_YEAR = 2001;

/**
 * The year a month written without one most likely means: the one that puts
 * it nearest the template's own month (`around`, "2026-12"), so a "Jan" in a
 * December template is the January after it. Leap years then come out right.
 */
function yearNear(index: number, around: string | undefined): number {
  const key = around ? /^(\d{4})-(\d{2})/.exec(around) : null;
  if (!key) return NO_YEAR;
  const at = Number(key[1]) * 12 + Number(key[2]) - 1;
  const y = Number(key[1]);
  return [y, y + 1, y - 1].reduce((best, year) =>
    Math.abs(year * 12 + index - at) < Math.abs(best * 12 + index - at) ? year : best,
  );
}

type MonthMention = {
  start: number;
  end: number;
  dayFirst: boolean;
  /** " of", as in "31st of December", or "". */
  of: string;
  index: number;
  short: boolean;
  dot: string;
  days: { n: number; ordinal: boolean }[];
  sep: string;
  /** What comes before the year, as written: " " or ", ". */
  yearGap: string | null;
  year: number | null;
  /** A year taken from the month it is joined to ("Oct" in "Oct–Dec 2026"). */
  borrowed: boolean;
};

function readMention(m: RegExpMatchArray): MonthMention | null {
  const g = m.groups!;
  const dayFirst = g.d1 !== undefined;
  const name = dayFirst ? g.name : g.uName;
  const full = MONTHS.indexOf(name as (typeof MONTHS)[number]);
  const index = full >= 0 ? full : SHORT_MONTHS.indexOf(name === "Sept" ? "Sep" : name);
  if (index < 0) return null;
  const day = (raw: string | undefined) =>
    raw === undefined ? [] : [{ n: parseInt(raw, 10), ordinal: /\D$/.test(raw) }];
  const yearRaw = dayFirst ? g.year : g.uYear;
  return {
    start: m.index!,
    end: m.index! + m[0].length,
    dayFirst,
    of: (dayFirst ? g.of : "") ?? "",
    index,
    short: full < 0,
    dot: (dayFirst ? g.dot : g.uDot) ?? "",
    days: dayFirst ? [...day(g.d1), ...day(g.d2)] : [...day(g.ud1), ...day(g.ud2)],
    sep: (dayFirst ? g.sep : g.uSep) ?? "",
    yearGap: yearRaw ? yearRaw.slice(0, yearRaw.length - 4) : null,
    year: yearRaw ? Number(yearRaw.slice(-4)) : null,
    borrowed: false,
  };
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

/** A day of a month moved to another: the last day stays the last day. */
function moveDay(n: number, from: { y: number; m: number }, to: { y: number; m: number }): number {
  const last = daysInMonth(to.y, to.m);
  return n === daysInMonth(from.y, from.m) ? last : Math.min(n, last);
}

/**
 * Moves every month a text mentions on by `offset` months, so a copy of
 * "Website care — November 2026" made for December says December.
 *
 * A template is a real invoice the client has had, so it can't carry
 * {{month}} tags in its own title without showing them. Instead its months
 * move with the period: a month with a day or a year ("November 2026",
 * "Nov 2026", "December 1–31, 2026", "1 Jan 2027") always, a full month name
 * on its own ("November") too. A short name on its own, and "May" on its
 * own, are left alone; they are too often something else, and so is a year
 * that isn't a month's ("© 2026").
 *
 * The style is kept: short stays short, a year written with the month rolls
 * over with it, a month's last day stays its last day ("Jan 1–31" becomes
 * "Feb 1–28"), and a month joined to a dated one ("Oct–Dec 2026") takes its
 * year. With `days` (a weekly plan), a mention with a day moves by that many
 * days instead, since its weeks don't line up with the months. A month
 * written without a year is read in the year nearest `around`, the
 * template's own month ("2026-11"), so its last day and its weeks fall where
 * they do in that year.
 */
export function shiftMonths(text: string, offset: number, days = 0, around?: string): string {
  if ((!offset && !days) || !text) return text;
  const mentions = [...text.matchAll(MONTH_DATE)].map(readMention);
  // Right to left, so a chain like "Oct–Nov–Dec 2026" passes the year along.
  for (let i = mentions.length - 2; i >= 0; i--) {
    const a = mentions[i];
    const b = mentions[i + 1];
    if (!a || !b || a.year !== null || b.year === null) continue;
    if (!MONTH_JOIN.test(text.slice(a.end, b.start))) continue;
    a.year = b.index < a.index ? b.year - 1 : b.year;
    a.borrowed = true;
  }

  type Moved = { y: number; m: number; d: number[] }[];
  const moved: (Moved | null)[] = mentions.map((mention) => {
    if (!mention) return null;
    const { days: ds, index, year } = mention;
    if (year === null && !ds.length && (mention.short || !STANDALONE.includes(MONTHS[index]))) {
      return null;
    }
    const from = { y: year ?? yearNear(index, around), m: index + 1 };
    if (days && ds.length) {
      // Each day on its own: a week can start in one month and end in the next.
      return ds.map(({ n }) => {
        const p = parts(addDays(format(from.y, from.m, Math.min(n, daysInMonth(from.y, from.m))), days));
        return { y: p.y, m: p.m, d: [p.d] };
      });
    }
    const total = from.y * 12 + index + offset;
    const to = { y: Math.floor(total / 12), m: (((total % 12) + 12) % 12) + 1 };
    return [{ ...to, d: ds.map(({ n }) => moveDay(n, from, to)) }];
  });

  let out = "";
  let at = 0;
  mentions.forEach((mention, i) => {
    const dates = moved[i];
    if (!mention || !dates) return;
    const label = (m: number) => `${(mention.short ? SHORT_MONTHS : MONTHS)[m - 1]}${mention.dot}`;
    const dayText = (n: number, k: number) => `${n}${mention.days[k]?.ordinal ? ordinal(n) : ""}`;
    const yearOf = (y: number, gap: string | null) => (gap === null ? "" : `${gap}${y}`);
    const first = dates[0];
    const last = dates[dates.length - 1];
    // A borrowed year is shown only once its month lands in another year
    // than the month it is joined to.
    const next = moved[i + 1]?.[0];
    const gap = mention.borrowed
      ? next && next.y !== last.y
        ? mention.days.length && !mention.dayFirst ? ", " : " "
        : null
      : mention.year === null
        ? null
        : mention.yearGap;
    let written: string;
    if (dates.length === 2 && (first.y !== last.y || first.m !== last.m)) {
      // A day range that now runs into the next month names both months,
      // and both years when it runs into the next year.
      const crossYear = first.y !== last.y && mention.year !== null;
      const yearGap = mention.dayFirst ? " " : ", ";
      const firstYear = crossYear ? `${yearGap}${first.y}` : "";
      const lastYear = yearOf(last.y, crossYear && gap === null ? yearGap : gap);
      written = mention.dayFirst
        ? `${dayText(first.d[0], 0)}${mention.of} ${label(first.m)}${firstYear}${mention.sep}${dayText(last.d[0], 1)}${mention.of} ${label(last.m)}${lastYear}`
        : `${label(first.m)} ${dayText(first.d[0], 0)}${firstYear}${mention.sep}${label(last.m)} ${dayText(last.d[0], 1)}${lastYear}`;
    } else {
      const ds = dates.flatMap((date) => date.d).map(dayText);
      const dayPart = ds.join(mention.sep);
      written = mention.dayFirst
        ? `${dayPart}${mention.of} ${label(last.m)}${yearOf(last.y, gap)}`
        : `${label(last.m)}${dayPart ? ` ${dayPart}` : ""}${yearOf(last.y, gap)}`;
    }
    out += text.slice(at, mention.start) + written;
    at = mention.end;
  });
  return out + text.slice(at);
}

type DocNode = { text?: string; content?: DocNode[]; [key: string]: unknown };

/** shiftMonths over every text node of a Tiptap document, returning a new one. */
export function shiftMonthsInDoc(doc: unknown, offset: number, days = 0, around?: string): unknown {
  if ((!offset && !days) || doc == null || typeof doc !== "object") return doc;
  const walk = (node: DocNode): DocNode => {
    const next: DocNode = { ...node };
    if (typeof next.text === "string") next.text = shiftMonths(next.text, offset, days, around);
    if (Array.isArray(next.content)) next.content = next.content.map(walk);
    return next;
  };
  return Array.isArray(doc) ? (doc as DocNode[]).map(walk) : walk(doc as DocNode);
}

/**
 * What a plan's template is read from: its own period on the plan ("2026-11",
 * or "2026-W45" for a weekly plan) when it has one of the plan's kind, else
 * the day it was issued.
 */
export function templateFrom(own: string | null, issued: Day, frequency: ScheduleUnit): string {
  const pattern = frequency === "WEEK" ? /^\d{4}-W\d{2}$/ : /^\d{4}-\d{2}$/;
  return own && pattern.test(own) ? own : issued;
}

/**
 * How far a template's dates move for a run on `day`, as shiftMonths takes
 * it. A monthly plan's move by the months from the template's month. A weekly
 * plan's move by whole weeks, since its weeks don't line up with the months:
 * "2 – 8 Nov 2026" reads "9 – 15 Nov 2026" a week on. Its months follow the
 * template's run day in its own week, so a "November 2026" reads "December
 * 2026" on a run in December. `around` is the template's month.
 */
export function templateShift(
  from: string,
  day: Day,
  frequency: ScheduleUnit,
): { offset: number; days: number; around: string } {
  if (frequency === "WEEK") {
    const days = daysBetweenWeeks(from, day);
    const at = addDays(day, -days);
    return { offset: monthsBetween(at, day), days, around: at.slice(0, 7) };
  }
  const month = from.slice(0, 7);
  return { offset: monthsBetween(month, day), days: 0, around: month };
}

/** A month name, and the year written after it. */
const MONTH_WORD = new RegExp(
  `\\b(${[...MONTHS, "Sept", ...SHORT_MONTHS].join("|")})(\\.?)(\\s+(\\d{4}))?\\b`,
  "g",
);

/** Text with its month mentions taken out, for a plan named after an invoice. */
export function withoutMonths(text: string): string {
  return text
    .replace(MONTH_WORD, (match, name: string, _dot: string, _yearPart?: string, year?: string) =>
      year || STANDALONE.includes(name) ? "" : match,
    )
    .replace(/\s*[—–:|·-]\s*$/, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------- cadence

export const CADENCE_PRESETS = [
  { id: "monthly", label: "Monthly", frequency: "MONTH", interval: 1 },
  { id: "biweekly", label: "Every 2 weeks", frequency: "WEEK", interval: 2 },
  { id: "quarterly", label: "Quarterly", frequency: "MONTH", interval: 3 },
  { id: "yearly", label: "Yearly", frequency: "MONTH", interval: 12 },
] as const satisfies readonly ({ id: string; label: string } & Cadence)[];

export type CadencePreset = (typeof CADENCE_PRESETS)[number]["id"] | "custom";

export function presetOf(cadence: Cadence): CadencePreset {
  return (
    CADENCE_PRESETS.find(
      (p) => p.frequency === cadence.frequency && p.interval === cadence.interval,
    )?.id ?? "custom"
  );
}

/** "Monthly", "Every 2 weeks", "Quarterly", "Every 6 months"… */
export function cadenceLabel(cadence: Cadence): string {
  const preset = CADENCE_PRESETS.find(
    (p) => p.frequency === cadence.frequency && p.interval === cadence.interval,
  );
  if (preset) return preset.label;
  if (cadence.interval === 1) return cadence.frequency === "WEEK" ? "Weekly" : "Monthly";
  return `Every ${cadence.interval} ${cadence.frequency === "WEEK" ? "weeks" : "months"}`;
}

/** The short suffix after an amount: "/mo", "/qtr", "/2 wk". */
export function cadenceSuffix(cadence: Cadence): string {
  if (cadence.frequency === "MONTH") {
    if (cadence.interval === 1) return "/mo";
    if (cadence.interval === 3) return "/qtr";
    if (cadence.interval === 12) return "/yr";
    return `/${cadence.interval} mo`;
  }
  return cadence.interval === 1 ? "/wk" : `/${cadence.interval} wk`;
}

/**
 * What one invoice is worth per month: a quarterly plan is a third of its
 * amount, a weekly one 52/12 of it.
 */
export function monthlyFactor(cadence: Cadence): number {
  const interval = Math.max(cadence.interval, 1);
  return cadence.frequency === "MONTH" ? 1 / interval : 52 / 12 / interval;
}

/**
 * Monthly recurring revenue in USD, plus how many plans were left out for
 * want of a USD value. A plan billed in another currency counts through the
 * USD value set on it, never at face value, the way sumUsd treats invoices.
 */
export function monthlyUsd(plans: (UsdSource & Cadence)[]): { total: number; missing: number } {
  let total = 0;
  let missing = 0;
  for (const plan of plans) {
    const value = usdValue(plan);
    if (value == null) missing++;
    else total += value * monthlyFactor(plan);
  }
  return { total: Math.round(total * 100) / 100, missing };
}
