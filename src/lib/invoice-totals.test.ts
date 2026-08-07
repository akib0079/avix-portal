import { describe, it, expect } from "vitest";
import { invoiceTotals, balanceDue, dueDateFromTerms } from "./invoice-totals";

describe("invoiceTotals", () => {
  it("sums qty × rate across line items", () => {
    const totals = invoiceTotals({
      items: [
        { qty: 2, rate: 50 },
        { qty: 1, rate: 100 },
      ],
    });
    expect(totals.subtotal).toBe(200);
    expect(totals.total).toBe(200);
  });

  it("falls back to a flat amount when there are no line items", () => {
    const totals = invoiceTotals({ amount: 750 });
    expect(totals.subtotal).toBe(750);
  });

  it("treats an empty items array the same as no items", () => {
    const totals = invoiceTotals({ items: [], amount: 300 });
    expect(totals.subtotal).toBe(300);
  });

  it("applies a discount before tax", () => {
    const totals = invoiceTotals({ amount: 1000, discount: 100, taxRate: 10 });
    expect(totals.discount).toBe(100);
    expect(totals.taxable).toBe(900);
    expect(totals.taxAmount).toBe(90);
    expect(totals.total).toBe(990);
  });

  it("clamps a discount to the subtotal so a total can never go negative", () => {
    const totals = invoiceTotals({ amount: 100, discount: 500 });
    expect(totals.discount).toBe(100);
    expect(totals.taxable).toBe(0);
    expect(totals.total).toBe(0);
  });

  it("clamps a negative discount to zero rather than inflating the total", () => {
    const totals = invoiceTotals({ amount: 100, discount: -50 });
    expect(totals.discount).toBe(0);
    expect(totals.total).toBe(100);
  });

  it("charges no tax when taxRate is zero, null, or omitted", () => {
    expect(invoiceTotals({ amount: 100, taxRate: 0 }).taxAmount).toBe(0);
    expect(invoiceTotals({ amount: 100, taxRate: null }).taxAmount).toBe(0);
    expect(invoiceTotals({ amount: 100 }).taxAmount).toBe(0);
  });

  it("rounds to the nearest cent so floating-point drift never reaches the UI", () => {
    const totals = invoiceTotals({
      items: [{ qty: 3, rate: 0.1 }],
    });
    expect(totals.subtotal).toBe(0.3);
  });
});

describe("balanceDue", () => {
  it("subtracts what's been paid", () => {
    expect(balanceDue(500, 200)).toBe(300);
  });

  it("never goes negative when overpaid", () => {
    expect(balanceDue(500, 900)).toBe(0);
  });

  it("rounds the result", () => {
    expect(balanceDue(10.1, 0.05)).toBe(10.05);
  });
});

describe("dueDateFromTerms", () => {
  it("adds net-terms days in UTC regardless of the local timezone", () => {
    // Regression: local-time arithmetic shifted this back a day for
    // timezones east of UTC (e.g. Dhaka, UTC+6).
    expect(dueDateFromTerms("2026-07-31", 14)).toBe("2026-08-14");
  });

  it("returns null when there are no terms", () => {
    expect(dueDateFromTerms("2026-07-31", null)).toBeNull();
    expect(dueDateFromTerms("2026-07-31", undefined)).toBeNull();
  });

  it("returns null for an unparsable issue date instead of throwing", () => {
    expect(dueDateFromTerms("not-a-date", 14)).toBeNull();
  });

  it("supports net-0 (due immediately)", () => {
    expect(dueDateFromTerms("2026-08-07", 0)).toBe("2026-08-07");
  });

  it("rolls across month and year boundaries", () => {
    expect(dueDateFromTerms("2026-12-25", 14)).toBe("2027-01-08");
  });
});
