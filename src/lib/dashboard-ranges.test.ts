import { describe, it, expect } from "vitest";
import { parseRange, rangeWindow } from "./dashboard-ranges";

describe("parseRange", () => {
  it("accepts a known range value", () => {
    expect(parseRange("quarter")).toBe("quarter");
  });

  it("defaults to 'month' for missing, unknown, or malicious input", () => {
    // This feeds a query param straight through — must never trust it.
    expect(parseRange(undefined)).toBe("month");
    expect(parseRange("")).toBe("month");
    expect(parseRange("literally-anything")).toBe("month");
    expect(parseRange("__proto__")).toBe("month");
  });
});

describe("rangeWindow", () => {
  const now = new Date(2026, 7, 7); // Aug 7, 2026 (local)

  it("'month' is the 1st of this month through the 1st of next", () => {
    const { start, end } = rangeWindow("month", now);
    expect(start).toEqual(new Date(2026, 7, 1));
    expect(end).toEqual(new Date(2026, 8, 1));
  });

  it("'last' is the entire previous calendar month", () => {
    const { start, end } = rangeWindow("last", now);
    expect(start).toEqual(new Date(2026, 6, 1));
    expect(end).toEqual(new Date(2026, 7, 1));
  });

  it("'quarter' spans the last 3 months up to and including this one", () => {
    const { start, end } = rangeWindow("quarter", now);
    expect(start).toEqual(new Date(2026, 5, 1));
    expect(end).toEqual(new Date(2026, 8, 1));
  });

  it("'ytd' starts January 1st of the current year", () => {
    const { start, end } = rangeWindow("ytd", now);
    expect(start).toEqual(new Date(2026, 0, 1));
    expect(end).toEqual(new Date(2026, 8, 1));
  });

  it("rolls a year boundary correctly ('last' in January is last December)", () => {
    const jan = new Date(2026, 0, 15);
    const { start, end } = rangeWindow("last", jan);
    expect(start).toEqual(new Date(2025, 11, 1));
    expect(end).toEqual(new Date(2026, 0, 1));
  });
});
