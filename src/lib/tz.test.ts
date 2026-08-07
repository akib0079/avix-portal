import { describe, it, expect } from "vitest";
import { tzOffsetMinutes, zonedWallTimeToUtc, zonedDateParts } from "./tz";

describe("tzOffsetMinutes", () => {
  it("returns 0 for UTC", () => {
    expect(tzOffsetMinutes(new Date("2026-08-07T12:00:00Z"), "UTC")).toBe(0);
  });

  it("returns a negative offset west of UTC", () => {
    // New York is EDT (UTC-4) in August.
    expect(tzOffsetMinutes(new Date("2026-08-07T12:00:00Z"), "America/New_York")).toBe(-240);
  });

  it("returns a positive offset east of UTC", () => {
    // Dhaka is fixed at UTC+6, no DST.
    expect(tzOffsetMinutes(new Date("2026-08-07T12:00:00Z"), "Asia/Dhaka")).toBe(360);
  });

  it("reflects a DST transition — same zone, different offset by season", () => {
    const summer = tzOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "America/New_York");
    const winter = tzOffsetMinutes(new Date("2026-01-01T12:00:00Z"), "America/New_York");
    expect(summer).toBe(-240); // EDT
    expect(winter).toBe(-300); // EST
  });
});

describe("zonedWallTimeToUtc", () => {
  it("converts a wall-clock time in a zone to the correct UTC instant", () => {
    // 9:00 AM in Dhaka (UTC+6) is 3:00 AM UTC.
    const utc = zonedWallTimeToUtc(2026, 8, 7, 9, 0, "Asia/Dhaka");
    expect(utc.toISOString()).toBe("2026-08-07T03:00:00.000Z");
  });

  it("resolves correctly across a DST boundary", () => {
    // 9:00 AM in New York in July is EDT (UTC-4) -> 13:00 UTC.
    const utc = zonedWallTimeToUtc(2026, 7, 1, 9, 0, "America/New_York");
    expect(utc.toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });
});

describe("zonedDateParts", () => {
  it("reads the calendar date as seen in the target zone, not UTC", () => {
    // 11 PM UTC on Aug 7 is already Aug 8 in Dhaka (UTC+6).
    const parts = zonedDateParts(new Date("2026-08-07T23:00:00Z"), "Asia/Dhaka");
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(8);
    expect(parts.day).toBe(8);
  });

  it("maps the weekday abbreviation to a 0-6 index (Sun=0)", () => {
    // 2026-08-07 is a Friday.
    const parts = zonedDateParts(new Date("2026-08-07T12:00:00Z"), "UTC");
    expect(parts.weekday).toBe(5);
  });
});
