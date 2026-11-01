import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  addMonths,
  advanceRun,
  cadenceLabel,
  cadenceSuffix,
  dayIn,
  defaultFirstRun,
  isDay,
  isoWeek,
  legacyNextRunDay,
  monthlyFactor,
  monthlyUsd,
  monthsBetween,
  nextRunDay,
  periodKey,
  periodVars,
  planState,
  planSummary,
  presetOf,
  previousRunDay,
  remainingRuns,
  rollForward,
  runAllowed,
  runInstant,
  shiftMonths,
  shiftMonthsInDoc,
  shortDay,
  upcomingRuns,
  withoutMonths,
  type Schedule,
} from "./recurring";
import { renderPeriodTags, renderPeriodTagsInDoc } from "./merge-tags";

const monthly = (dayOfMonth: number, interval = 1): Schedule => ({
  frequency: "MONTH",
  interval,
  dayOfMonth,
});
const weekly = (interval = 1): Schedule => ({ frequency: "WEEK", interval, dayOfMonth: 1 });

/** Every run from `start`, `count` of them. */
function runs(start: string, schedule: Schedule, count: number): string[] {
  const out = [start];
  while (out.length < count) out.push(nextRunDay(out[out.length - 1], schedule));
  return out;
}

test("a plan on the 31st bills on the last day of short months and comes back to the 31st", () => {
  assert.deepEqual(runs("2026-01-31", monthly(31), 6), [
    "2026-01-31",
    "2026-02-28",
    "2026-03-31",
    "2026-04-30",
    "2026-05-31",
    "2026-06-30",
  ]);
  // A leap year has its 29th.
  assert.equal(nextRunDay("2028-01-31", monthly(31)), "2028-02-29");
  assert.equal(nextRunDay("2028-02-29", monthly(31)), "2028-03-31");
  // The 30th never becomes the 28th for good either.
  assert.deepEqual(runs("2026-01-30", monthly(30), 4), [
    "2026-01-30",
    "2026-02-28",
    "2026-03-30",
    "2026-04-30",
  ]);
});

test("every 2, 3 and 12 months keeps its anchor day", () => {
  assert.deepEqual(runs("2026-11-15", monthly(15, 2), 4), [
    "2026-11-15",
    "2027-01-15",
    "2027-03-15",
    "2027-05-15",
  ]);
  assert.deepEqual(runs("2026-11-30", monthly(30, 3), 4), [
    "2026-11-30",
    "2027-02-28",
    "2027-05-30",
    "2027-08-30",
  ]);
  assert.deepEqual(runs("2028-02-29", monthly(29, 12), 5), [
    "2028-02-29",
    "2029-02-28",
    "2030-02-28",
    "2031-02-28",
    "2032-02-29",
  ]);
  assert.equal(previousRunDay("2027-02-28", monthly(30, 3)), "2026-11-30");
  assert.equal(previousRunDay("2026-03-31", monthly(31)), "2026-02-28");
});

test("weekly plans step whole weeks, across the end of a year", () => {
  assert.deepEqual(runs("2026-12-21", weekly(), 3), ["2026-12-21", "2026-12-28", "2027-01-04"]);
  assert.deepEqual(runs("2026-11-02", weekly(2), 3), ["2026-11-02", "2026-11-16", "2026-11-30"]);
  assert.equal(previousRunDay("2026-11-16", weekly(2)), "2026-11-02");
});

test("calendar arithmetic", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addMonths("2026-11-15", -12), "2025-11-15");
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(monthsBetween("2026-11", "2027-01"), 2);
  assert.equal(monthsBetween("2026-11", "2026-08"), -3);
  assert.ok(isDay("2028-02-29"));
  assert.ok(!isDay("2026-02-29"));
  assert.ok(!isDay("2026-13-01"));
  assert.ok(!isDay("26-11-01"));
});

test("periods are calendar months or ISO weeks, and sort as strings", () => {
  assert.equal(periodKey("2026-11-15", "MONTH"), "2026-11");
  assert.equal(periodKey("2026-11-02", "WEEK"), "2026-W45");
  assert.equal(periodKey("2026-11-08", "WEEK"), "2026-W45");
  assert.equal(periodKey("2026-11-09", "WEEK"), "2026-W46");
  // The first days of a year can belong to the last week of the one before.
  assert.equal(periodKey("2027-01-01", "WEEK"), "2026-W53");
  assert.equal(periodKey("2027-01-04", "WEEK"), "2027-W01");
  assert.equal(periodKey("2025-12-29", "WEEK"), "2026-W01");
  assert.deepEqual(isoWeek("2026-01-01"), { year: 2026, week: 1 });
  assert.ok(periodKey("2026-03-02", "WEEK") < periodKey("2026-11-02", "WEEK"));
  assert.ok(periodKey("2026-12-28", "WEEK") < periodKey("2027-01-04", "WEEK"));
});

test("a run is due at 6:00 agency time, whatever the server's zone or DST", () => {
  // New York: daylight time ends at 2:00 on 1 Nov 2026 and starts on 8 Mar.
  assert.equal(runInstant("2026-10-31", "America/New_York").toISOString(), "2026-10-31T10:00:00.000Z");
  assert.equal(runInstant("2026-11-01", "America/New_York").toISOString(), "2026-11-01T11:00:00.000Z");
  assert.equal(runInstant("2026-03-07", "America/New_York").toISOString(), "2026-03-07T11:00:00.000Z");
  assert.equal(runInstant("2026-03-08", "America/New_York").toISOString(), "2026-03-08T10:00:00.000Z");
  // London leaves summer time on 25 Oct 2026.
  assert.equal(runInstant("2026-10-24", "Europe/London").toISOString(), "2026-10-24T05:00:00.000Z");
  assert.equal(runInstant("2026-10-25", "Europe/London").toISOString(), "2026-10-25T06:00:00.000Z");
  // Dhaka is UTC+6 all year: 6:00 there is midnight UTC.
  assert.equal(runInstant("2026-11-02", "Asia/Dhaka").toISOString(), "2026-11-02T00:00:00.000Z");
  // An unknown zone falls back to UTC instead of throwing.
  assert.equal(runInstant("2026-11-02", "Not/AZone").toISOString(), "2026-11-02T06:00:00.000Z");
});

test("advancing keeps the hour across a DST change", () => {
  const ny = "America/New_York";
  const seen = runInstant("2026-10-26", ny);
  assert.equal(advanceRun(seen, weekly(), ny).toISOString(), "2026-11-02T11:00:00.000Z");
  assert.equal(dayIn(advanceRun(seen, weekly(), ny), ny), "2026-11-02");
  const march = runInstant("2026-02-08", ny);
  assert.equal(advanceRun(march, monthly(8), ny).toISOString(), "2026-03-08T10:00:00.000Z");
});

test("the day is the agency's, not UTC's", () => {
  const lateEvening = new Date("2026-11-02T03:00:00Z");
  assert.equal(dayIn(lateEvening, "America/New_York"), "2026-11-01");
  assert.equal(dayIn(lateEvening, "Asia/Dhaka"), "2026-11-02");
  assert.equal(dayIn(new Date("2026-11-01T19:59:18Z"), "Asia/Dhaka"), "2026-11-02");
  assert.equal(dayIn(lateEvening, "Not/AZone"), "2026-11-02");
});

test("plans from before schedules pick up after their last month, never before this one", () => {
  const today = "2026-11-02";
  // Drafted October: November's bill day is next, even though it has passed.
  assert.equal(legacyNextRunDay({ dayOfMonth: 1, lastGeneratedPeriod: "2026-10" }, today), "2026-11-01");
  assert.equal(legacyNextRunDay({ dayOfMonth: 15, lastGeneratedPeriod: "2026-10" }, today), "2026-11-15");
  // Drafted November already: December.
  assert.equal(legacyNextRunDay({ dayOfMonth: 1, lastGeneratedPeriod: "2026-11" }, today), "2026-12-01");
  // Months the old code missed stay missed: no backdated August draft.
  assert.equal(legacyNextRunDay({ dayOfMonth: 5, lastGeneratedPeriod: "2026-07" }, today), "2026-11-05");
  assert.equal(legacyNextRunDay({ dayOfMonth: 20, lastGeneratedPeriod: null }, today), "2026-11-20");
  assert.equal(legacyNextRunDay({ dayOfMonth: 31, lastGeneratedPeriod: null }, today), "2026-11-30");
  assert.equal(legacyNextRunDay({ dayOfMonth: 1, lastGeneratedPeriod: "garbage" }, today), "2026-11-01");
});

test("a plan made from an invoice starts a period later, and never in the past", () => {
  const monthlyCadence = { frequency: "MONTH", interval: 1 } as const;
  assert.equal(defaultFirstRun("2026-11-02", monthlyCadence, "2026-11-02"), "2026-12-02");
  assert.equal(defaultFirstRun("2026-07-10", monthlyCadence, "2026-11-02"), "2026-11-10");
  assert.equal(defaultFirstRun("2026-01-31", monthlyCadence, "2026-02-01"), "2026-02-28");
  assert.equal(
    defaultFirstRun("2026-11-02", { frequency: "WEEK", interval: 2 }, "2026-11-02"),
    "2026-11-16",
  );
  assert.equal(
    defaultFirstRun("2026-11-02", { frequency: "MONTH", interval: 3 }, "2026-11-02"),
    "2027-02-02",
  );
  assert.equal(rollForward("2026-08-01", monthly(1), "2026-11-02"), "2026-12-01");
  assert.equal(rollForward("2026-11-02", monthly(2), "2026-11-02"), "2026-11-02");
});

test("plans end after a number of invoices or after a date", () => {
  const never = { endAfterCount: null, endDay: null, runCount: 4 };
  assert.ok(runAllowed("2030-01-01", never));
  assert.equal(remainingRuns("2026-12-01", monthly(1), never), null);

  const twelve = { endAfterCount: 12, endDay: null, runCount: 10 };
  assert.ok(runAllowed("2026-12-01", twelve));
  assert.ok(!runAllowed("2026-12-01", { ...twelve, runCount: 12 }));
  assert.deepEqual(upcomingRuns("2026-12-01", monthly(1), twelve, 5), ["2026-12-01", "2027-01-01"]);
  assert.equal(remainingRuns("2026-12-01", monthly(1), twelve), 2);

  const byDate = { endAfterCount: null, endDay: "2027-02-01", runCount: 0 };
  // A run on the end date itself still happens.
  assert.deepEqual(upcomingRuns("2026-12-01", monthly(1), byDate, 5), [
    "2026-12-01",
    "2027-01-01",
    "2027-02-01",
  ]);
  assert.equal(remainingRuns("2026-12-01", monthly(1), byDate), 3);
  assert.ok(!runAllowed("2027-02-02", byDate));
  assert.equal(remainingRuns(null, monthly(1), byDate), 0);
});

test("period words for monthly, longer and weekly plans", () => {
  assert.deepEqual(periodVars("2026-11-01", monthly(1)), {
    period: "November 2026",
    month: "November",
    year: "2026",
    periodStart: "1 Nov 2026",
    periodEnd: "30 Nov 2026",
  });
  // A plan on the 15th still names its month, the way retainers always did.
  assert.equal(periodVars("2026-11-15", monthly(15)).period, "November 2026");
  assert.equal(periodVars("2026-11-15", monthly(15)).periodEnd, "14 Dec 2026");
  assert.equal(periodVars("2026-11-01", monthly(1, 3)).period, "Nov 2026 – Jan 2027");
  assert.equal(periodVars("2026-01-01", monthly(1, 12)).period, "Jan 2026 – Dec 2026");
  assert.equal(periodVars("2026-11-02", weekly()).period, "2 – 8 Nov 2026");
  assert.equal(periodVars("2026-11-30", weekly()).period, "30 Nov – 6 Dec 2026");
  assert.equal(periodVars("2026-12-28", weekly(2)).period, "28 Dec 2026 – 10 Jan 2027");
  assert.equal(shortDay("2026-12-01"), "1 Dec");
});

test("period tags render in text and documents, and leave other tags alone", () => {
  const vars = periodVars("2026-12-01", monthly(1));
  assert.equal(
    renderPeriodTags("Care — {{period}} ({{periodStart}} to {{ periodEnd }}), {{month}} {{year}}", vars),
    "Care — December 2026 (1 Dec 2026 to 31 Dec 2026), December 2026",
  );
  assert.equal(renderPeriodTags("Hi {{firstName}}", vars), "Hi {{firstName}}");
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "{{month}}", marks: [{ type: "bold" }] }] },
    ],
  };
  assert.deepEqual(renderPeriodTagsInDoc(doc, vars), {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "December", marks: [{ type: "bold" }] }] },
    ],
  });
  assert.equal(doc.content[0].content[0].text, "{{month}}");
});

test("a template's months move on with the period", () => {
  assert.equal(shiftMonths("Website care — November 2026", 1), "Website care — December 2026");
  assert.equal(shiftMonths("Hosting (Nov 2026)", 2), "Hosting (Jan 2027)");
  assert.equal(shiftMonths("Hosting (Nov. 2026)", 1), "Hosting (Dec. 2026)");
  assert.equal(shiftMonths("Retainer — December", 1), "Retainer — January");
  assert.equal(shiftMonths("October–November 2026", 1), "November–December 2026");
  assert.equal(shiftMonths("May 2026 support", 1), "June 2026 support");
  assert.equal(shiftMonths("March 2026", -3), "December 2025");
  // Left alone: "May" and short names on their own, and words that only start like a month.
  assert.equal(shiftMonths("Hours may vary. May include travel.", 1), "Hours may vary. May include travel.");
  assert.equal(shiftMonths("Jan's notes, Nov update", 1), "Jan's notes, Nov update");
  assert.equal(shiftMonths("Novel Marketing Decisions", 1), "Novel Marketing Decisions");
  assert.equal(shiftMonths("Website care — November 2026", 0), "Website care — November 2026");

  const doc = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Work in October 2026" }] }],
  };
  assert.deepEqual(shiftMonthsInDoc(doc, 1), {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Work in November 2026" }] }],
  });
  assert.equal(doc.content[0].content[0].text, "Work in October 2026");
});

test("a plan named after an invoice drops the month", () => {
  assert.equal(withoutMonths("Website care — November 2026"), "Website care");
  assert.equal(withoutMonths("Monthly retainer (November)"), "Monthly retainer");
  assert.equal(withoutMonths("Retainer: Nov 2026"), "Retainer");
  assert.equal(withoutMonths("SEO package"), "SEO package");
});

test("cadence words", () => {
  assert.equal(cadenceLabel({ frequency: "MONTH", interval: 1 }), "Monthly");
  assert.equal(cadenceLabel({ frequency: "WEEK", interval: 2 }), "Every 2 weeks");
  assert.equal(cadenceLabel({ frequency: "MONTH", interval: 3 }), "Quarterly");
  assert.equal(cadenceLabel({ frequency: "MONTH", interval: 12 }), "Yearly");
  assert.equal(cadenceLabel({ frequency: "WEEK", interval: 1 }), "Weekly");
  assert.equal(cadenceLabel({ frequency: "MONTH", interval: 6 }), "Every 6 months");
  assert.equal(presetOf({ frequency: "MONTH", interval: 3 }), "quarterly");
  assert.equal(presetOf({ frequency: "WEEK", interval: 3 }), "custom");
  assert.equal(cadenceSuffix({ frequency: "MONTH", interval: 1 }), "/mo");
  assert.equal(cadenceSuffix({ frequency: "WEEK", interval: 2 }), "/2 wk");
});

test("MRR is the monthly share of each plan, in USD", () => {
  assert.equal(monthlyFactor({ frequency: "MONTH", interval: 3 }), 1 / 3);
  assert.equal(monthlyFactor({ frequency: "WEEK", interval: 1 }), 52 / 12);
  const plans = [
    { amount: 250, currency: "USD", amountUsd: null, frequency: "MONTH", interval: 1 },
    { amount: 300, currency: "USD", amountUsd: 300, frequency: "MONTH", interval: 3 },
    { amount: 120, currency: "USD", amountUsd: null, frequency: "MONTH", interval: 12 },
    { amount: 100, currency: "USD", amountUsd: null, frequency: "WEEK", interval: 2 },
    // A EUR plan counts through its USD value, never at face value.
    { amount: 200, currency: "EUR", amountUsd: 216, frequency: "MONTH", interval: 1 },
    { amount: 999, currency: "GBP", amountUsd: null, frequency: "MONTH", interval: 1 },
  ] as const;
  const result = monthlyUsd(plans.map((p) => ({ ...p })));
  // 250 + 100 + 10 + 216.67 + 216 = 792.67
  assert.equal(result.total, 792.67);
  assert.equal(result.missing, 1);
  assert.deepEqual(monthlyUsd([]), { total: 0, missing: 0 });
});

test("a plan's state and what its page says about it", () => {
  const base = {
    frequency: "MONTH",
    interval: 1,
    dayOfMonth: 1,
    active: true,
    nextRunAt: null,
    endAfterCount: null,
    endDate: null,
    runCount: 0,
    lastGeneratedPeriod: "2026-10",
  } as const;
  const ny = "America/New_York";
  const now = new Date("2026-11-02T15:00:00Z");

  assert.equal(planState(base), "active");
  assert.equal(planState({ ...base, active: false, nextRunAt: new Date() }), "paused");
  // A plan from before schedules has no end, so inactive means paused.
  assert.equal(planState({ ...base, active: false }), "paused");
  assert.equal(planState({ ...base, active: false, endAfterCount: 3 }), "ended");

  // November hasn't been drafted and its day has passed: it is due.
  const legacy = planSummary(base, ny, now);
  assert.equal(legacy.nextDay, "2026-11-01");
  assert.equal(legacy.due, true);
  assert.deepEqual(legacy.upcoming, ["2026-11-01", "2026-12-01", "2027-01-01"]);
  assert.equal(legacy.remaining, null);
  assert.equal(legacy.cadence, "Monthly");

  const drafted = planSummary({ ...base, lastGeneratedPeriod: "2026-11" }, ny, now);
  assert.equal(drafted.nextDay, "2026-12-01");
  assert.equal(drafted.due, false);

  const scheduled = planSummary(
    { ...base, nextRunAt: runInstant("2026-12-01", ny), endAfterCount: 3, runCount: 2 },
    ny,
    now,
  );
  assert.equal(scheduled.nextDay, "2026-12-01");
  assert.deepEqual(scheduled.upcoming, ["2026-12-01"]);
  assert.equal(scheduled.remaining, 1);

  const ended = planSummary(
    { ...base, active: false, endAfterCount: 3, runCount: 3 },
    ny,
    now,
  );
  assert.equal(ended.state, "ended");
  assert.equal(ended.nextDay, null);
  assert.equal(ended.remaining, 0);
  assert.equal(ended.due, false);
});
