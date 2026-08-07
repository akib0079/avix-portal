import { describe, it, expect } from "vitest";
import { formatDate, formatPricing, milestoneTotal, initials, formatMoney } from "./format";

describe("formatDate", () => {
  it("formats as 'Mon D, YYYY'", () => {
    expect(formatDate("2026-08-07")).toBe("Aug 7, 2026");
  });

  it("renders an em dash for null/undefined instead of 'Invalid Date'", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });
});

describe("formatPricing", () => {
  it("shows the hourly breakdown with the computed total", () => {
    const label = formatPricing({
      pricingType: "HOURLY",
      hourlyRate: 80,
      estimatedHours: 5,
      fixedPrice: null,
    });
    expect(label).toBe("$80.00/hr × 5h = $400.00");
  });

  it("shows just the rate when hours aren't estimated yet", () => {
    const label = formatPricing({
      pricingType: "HOURLY",
      hourlyRate: 80,
      estimatedHours: null,
      fixedPrice: null,
    });
    expect(label).toBe("$80.00/hr");
  });

  it("shows a fixed price as '<amount> fixed'", () => {
    const label = formatPricing({
      pricingType: "FIXED",
      hourlyRate: null,
      estimatedHours: null,
      fixedPrice: 1200,
    });
    expect(label).toBe("$1,200.00 fixed");
  });

  it("returns null for no-charge milestones so the UI can hide the line", () => {
    const label = formatPricing({
      pricingType: "NONE",
      hourlyRate: null,
      estimatedHours: null,
      fixedPrice: null,
    });
    expect(label).toBeNull();
  });

  it("accepts Prisma Decimal values serialized as strings", () => {
    const label = formatPricing({
      pricingType: "FIXED",
      hourlyRate: null,
      estimatedHours: null,
      fixedPrice: "500.5",
    });
    expect(label).toBe("$500.50 fixed");
  });
});

describe("milestoneTotal", () => {
  it("multiplies rate × hours for hourly pricing", () => {
    expect(
      milestoneTotal({ pricingType: "HOURLY", hourlyRate: 80, estimatedHours: 5, fixedPrice: null }),
    ).toBe(400);
  });

  it("returns 0 when hourly but hours aren't set yet", () => {
    expect(
      milestoneTotal({ pricingType: "HOURLY", hourlyRate: 80, estimatedHours: null, fixedPrice: null }),
    ).toBe(0);
  });

  it("returns the flat price for fixed pricing", () => {
    expect(
      milestoneTotal({ pricingType: "FIXED", hourlyRate: null, estimatedHours: null, fixedPrice: 900 }),
    ).toBe(900);
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("Jane Cooper")).toBe("JC");
  });

  it("caps at two initials for longer names", () => {
    expect(initials("Jane Middle Cooper")).toBe("JM");
  });

  it("handles a single name", () => {
    expect(initials("Cher")).toBe("C");
  });

  it("collapses repeated whitespace instead of producing a blank initial", () => {
    expect(initials("  Jane   Cooper  ")).toBe("JC");
  });
});

describe("formatMoney", () => {
  it("defaults to USD", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
  });

  it("formats EUR with its own symbol so currencies are never mixed", () => {
    expect(formatMoney(1234.5, "EUR")).toContain("1,234.50");
    expect(formatMoney(1234.5, "EUR")).not.toContain("$");
  });
});
