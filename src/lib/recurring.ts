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
const STANDALONE = MONTHS.filter((name) => name !== "May");
const MONTH_WORD = new RegExp(
  `\\b(${[...MONTHS, "Sept", ...SHORT_MONTHS].join("|")})(\\.?)(\\s+(\\d{4}))?\\b`,
  "g",
);

/**
 * Moves every month a text mentions on by `offset` months, so a copy of
 * "Website care — November 2026" made for December says December.
 *
 * A template is a real invoice the client has had, so it can't carry
 * {{month}} tags in its own title without showing them. Instead its months
 * move with the period: a month with a year ("November 2026", "Nov 2026")
 * always, a full month name on its own ("November") too. A short name on its
 * own, and "May" on its own, are left alone; they are too often something
 * else. The style is kept: short stays short, a year rolls over with it.
 */
export function shiftMonths(text: string, offset: number): string {
  if (!offset || !text) return text;
  return text.replace(MONTH_WORD, (match, name: string, dot: string, yearPart?: string, year?: string) => {
    const full = MONTHS.indexOf(name as (typeof MONTHS)[number]);
    const index = full >= 0 ? full : SHORT_MONTHS.indexOf(name === "Sept" ? "Sep" : name);
    if (index < 0) return match;
    if (!year && !STANDALONE.includes(name as (typeof MONTHS)[number])) return match;
    const total = (year ? Number(year) : 0) * 12 + index + offset;
    const month = ((total % 12) + 12) % 12;
    const label = full >= 0 ? MONTHS[month] : SHORT_MONTHS[month];
    if (!year) return `${label}${dot}`;
    return `${label}${dot}${yearPart!.slice(0, yearPart!.length - year.length)}${Math.floor(total / 12)}`;
  });
}

type DocNode = { text?: string; content?: DocNode[]; [key: string]: unknown };

/** shiftMonths over every text node of a Tiptap document, returning a new one. */
export function shiftMonthsInDoc(doc: unknown, offset: number): unknown {
  if (!offset || doc == null || typeof doc !== "object") return doc;
  const walk = (node: DocNode): DocNode => {
    const next: DocNode = { ...node };
    if (typeof next.text === "string") next.text = shiftMonths(next.text, offset);
    if (Array.isArray(next.content)) next.content = next.content.map(walk);
    return next;
  };
  return Array.isArray(doc) ? (doc as DocNode[]).map(walk) : walk(doc as DocNode);
}

/** Text with its month mentions taken out, for a plan named after an invoice. */
export function withoutMonths(text: string): string {
  return text
    .replace(MONTH_WORD, (match, name: string, _dot: string, _yearPart?: string, year?: string) =>
      year || STANDALONE.includes(name as (typeof MONTHS)[number]) ? "" : match,
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
