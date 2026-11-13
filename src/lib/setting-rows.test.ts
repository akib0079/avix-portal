import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENCY_TZ_KEY,
  BOOKING_URL_KEY,
  GCAL_EMAIL_KEY,
  GCAL_ID_KEY,
  GCAL_REFRESH_KEY,
  SLOT_MIN_KEY,
  bookingConfigFrom,
  calendarStatusFrom,
} from "./setting-rows";

const row = (key: string, value: string) => ({ key, value });

test("booking config falls back to the defaults when no rows exist", () => {
  assert.deepEqual(bookingConfigFrom([]), {
    agencyTimezone: "America/New_York",
    slotMinutes: 30,
    bookingUrl: null,
  });
});

test("booking config reads present rows and ignores other keys", () => {
  assert.deepEqual(
    bookingConfigFrom([
      row(AGENCY_TZ_KEY, "Pacific/Auckland"),
      row(SLOT_MIN_KEY, "45"),
      row(BOOKING_URL_KEY, "https://meet.example.com/x"),
      row("monthlyRevenueTarget", "10000"),
      row(GCAL_REFRESH_KEY, "secret"),
    ]),
    { agencyTimezone: "Pacific/Auckland", slotMinutes: 45, bookingUrl: "https://meet.example.com/x" },
  );
});

test("booking config replaces blank or invalid values with the defaults", () => {
  for (const slot of ["", "abc", "0", "-15", "Infinity"]) {
    assert.equal(bookingConfigFrom([row(SLOT_MIN_KEY, slot)]).slotMinutes, 30, slot);
  }
  const blank = bookingConfigFrom([row(AGENCY_TZ_KEY, ""), row(BOOKING_URL_KEY, "")]);
  assert.equal(blank.agencyTimezone, "America/New_York");
  assert.equal(blank.bookingUrl, null);
});

test("calendar status with no rows is disconnected on the primary calendar", () => {
  assert.deepEqual(calendarStatusFrom([]), { connected: false, email: null, calendarId: "primary" });
});

test("calendar status reads present rows and never exposes the token", () => {
  const status = calendarStatusFrom([
    row(GCAL_REFRESH_KEY, "refresh-token"),
    row(GCAL_EMAIL_KEY, "team@example.com"),
    row(GCAL_ID_KEY, "cal-1"),
    row(AGENCY_TZ_KEY, "UTC"),
  ]);
  assert.deepEqual(status, { connected: true, email: "team@example.com", calendarId: "cal-1" });
  assert.equal(JSON.stringify(status).includes("refresh-token"), false);
});

test("calendar status treats blank values as missing", () => {
  assert.deepEqual(
    calendarStatusFrom([row(GCAL_REFRESH_KEY, ""), row(GCAL_EMAIL_KEY, ""), row(GCAL_ID_KEY, "")]),
    { connected: false, email: null, calendarId: "primary" },
  );
});
