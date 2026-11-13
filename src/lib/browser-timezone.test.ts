import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TIMEZONE_RESEND_MS,
  parseBrowserTimezone,
  timezoneMarker,
  timezoneMarkerKey,
  timezoneRecentlySent,
} from "./browser-timezone";

test("parseBrowserTimezone keeps real IANA zones, trimmed", () => {
  assert.equal(parseBrowserTimezone("America/New_York"), "America/New_York");
  assert.equal(parseBrowserTimezone("  Europe/London "), "Europe/London");
  assert.equal(parseBrowserTimezone("UTC"), "UTC");
});

test("parseBrowserTimezone rejects anything else", () => {
  assert.equal(parseBrowserTimezone("Mars/Olympus_Mons"), null);
  assert.equal(parseBrowserTimezone(""), null);
  assert.equal(parseBrowserTimezone("   "), null);
  assert.equal(parseBrowserTimezone(`Europe/${"x".repeat(80)}`), null);
  assert.equal(parseBrowserTimezone(undefined), null);
  assert.equal(parseBrowserTimezone(42), null);
  assert.equal(parseBrowserTimezone({ timezone: "UTC" }), null);
});

test("timezoneRecentlySent skips only the same zone sent within the window", () => {
  const now = 1_800_000_000_000;
  const marker = timezoneMarker("Asia/Dhaka", now - 60_000);
  assert.equal(timezoneRecentlySent(marker, "Asia/Dhaka", now), true);
  assert.equal(timezoneRecentlySent(marker, "Europe/London", now), false);
  assert.equal(timezoneRecentlySent(timezoneMarker("Asia/Dhaka", now - TIMEZONE_RESEND_MS), "Asia/Dhaka", now), false);
});

test("timezoneRecentlySent sends again on a missing, old-style or odd marker", () => {
  const now = 1_800_000_000_000;
  assert.equal(timezoneRecentlySent(null, "UTC", now), false);
  assert.equal(timezoneRecentlySent("UTC", "UTC", now), false);
  assert.equal(timezoneRecentlySent("UTC|soon", "UTC", now), false);
  assert.equal(timezoneRecentlySent(timezoneMarker("UTC", now + 60_000), "UTC", now), false);
});

test("timezoneMarkerKey is per user", () => {
  assert.notEqual(timezoneMarkerKey("a"), timezoneMarkerKey("b"));
});
