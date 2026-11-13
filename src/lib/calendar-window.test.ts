import { test } from "node:test";
import assert from "node:assert/strict";
import { dayIn } from "./calendar-days";
import { calendarRange, fetchWindow, type CalendarParams } from "./calendar-window";

const ZONES = [
  "Pacific/Auckland",
  "America/Los_Angeles",
  "Pacific/Kiritimati", // UTC+14
  "Etc/GMT+12", // UTC-12
  "Asia/Kolkata",
  "UTC",
];

// The 1st and the last day of months, near both ends of the UTC day, plus a
// year end and a leap day.
const INSTANTS = [
  "2026-03-01T00:30:00Z",
  "2026-03-01T12:00:00Z",
  "2026-03-31T11:30:00Z",
  "2026-03-31T23:30:00Z",
  "2026-04-30T18:00:00Z",
  "2026-12-31T23:59:00Z",
  "2027-01-01T00:01:00Z",
  "2028-02-29T10:00:00Z",
];

const PARAMS: CalendarParams[] = [
  {},
  { month: "2026-03" },
  { month: "2026-04" },
  { month: "2027-01" },
  { week: "2026-03-04" },
  { week: "2026-12-30" },
  { month: "2026-13" }, // invalid: falls back to today
  { week: "nope", month: "2026-03" },
];

test("the fetch window always holds the view computed with the real zone", () => {
  for (const iso of INSTANTS) {
    const now = new Date(iso);
    for (const params of PARAMS) {
      const win = fetchWindow(params, now);
      for (const tz of ZONES) {
        const real = calendarRange(params, dayIn(now, tz));
        const label = `${iso} ${tz} ${JSON.stringify(params)}`;
        assert.ok(win.from.getTime() <= real.from.getTime(), label);
        assert.ok(win.to.getTime() >= real.to.getTime(), label);
      }
    }
  }
});

test("Auckland on the 1st, while UTC is still on the 31st, shows the new month", () => {
  const now = new Date("2026-03-31T12:00:00Z"); // 1 April, 01:00 in Auckland
  const real = calendarRange({}, dayIn(now, "Pacific/Auckland"));
  assert.equal(real.monthKey, "2026-04");
  const win = fetchWindow({}, now);
  assert.ok(win.to.getTime() >= real.to.getTime());
});

test("Los Angeles on the last day, while UTC is already on the 1st, keeps the old month", () => {
  const now = new Date("2026-05-01T03:00:00Z"); // 30 April, 20:00 in Los Angeles
  const real = calendarRange({}, dayIn(now, "America/Los_Angeles"));
  assert.equal(real.monthKey, "2026-04");
  const win = fetchWindow({}, now);
  assert.ok(win.from.getTime() <= real.from.getTime());
});

test("?week= picks that week's Monday and the month most of it is in", () => {
  const r = calendarRange({ week: "2026-04-01" }, "2026-01-15");
  assert.equal(r.weekKey, "2026-03-30");
  assert.equal(r.monthKey, "2026-04");
});

test("?month= keeps today's week in the current month and the 1st otherwise", () => {
  assert.equal(calendarRange({ month: "2026-03" }, "2026-03-18").weekKey, "2026-03-16");
  assert.equal(calendarRange({ month: "2026-05" }, "2026-03-18").weekKey, "2026-04-27");
});

test("the view pads its grid two days each side", () => {
  const r = calendarRange({ month: "2026-03" }, "2026-01-15");
  // Grid starts Monday 23 Feb and runs 42 days, to 6 April.
  assert.equal(r.from.toISOString(), "2026-02-21T00:00:00.000Z");
  assert.equal(r.to.toISOString(), "2026-04-08T00:00:00.000Z");
});
