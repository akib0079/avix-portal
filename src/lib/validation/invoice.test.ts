import { describe, it, expect } from "vitest";
import { invoiceSchema } from "./invoice";

const base = {
  clientId: "client-1",
  projectId: "project-1",
  status: "ASSIGNED" as const,
  issueDate: "2026-08-07",
};

describe("invoiceSchema", () => {
  it("requires a positive amount when there are no line items", () => {
    const result = invoiceSchema.safeParse({ ...base, amount: 0 });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.path[0] === "amount");
    expect(issue?.message).toBe("Enter an amount (or add line items)");
  });

  it("allows amount to be 0 (a placeholder) when line items are present", () => {
    const result = invoiceSchema.safeParse({
      ...base,
      amount: 0,
      items: [{ description: "Design", qty: 1, rate: 500 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a flat amount with no line items", () => {
    const result = invoiceSchema.safeParse({ ...base, amount: 500 });
    expect(result.success).toBe(true);
  });

  it("requires selecting a client and project", () => {
    const result = invoiceSchema.safeParse({ ...base, clientId: "", amount: 500 });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === "clientId")).toBe(true);
  });

  it("rejects an invoice number with disallowed characters", () => {
    const result = invoiceSchema.safeParse({ ...base, amount: 500, invoiceNumber: "INV #1" });
    expect(result.success).toBe(false);
  });

  it("accepts an empty invoice number (auto-assigned)", () => {
    const result = invoiceSchema.safeParse({ ...base, amount: 500, invoiceNumber: "" });
    expect(result.success).toBe(true);
  });

  it("accepts letters, numbers, dashes, underscores and slashes in an invoice number", () => {
    const result = invoiceSchema.safeParse({ ...base, amount: 500, invoiceNumber: "2026/INV-007_a" });
    expect(result.success).toBe(true);
  });

  it("caps the tax rate at 100 percent", () => {
    const result = invoiceSchema.safeParse({ ...base, amount: 500, taxRate: 150 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative discount", () => {
    const result = invoiceSchema.safeParse({ ...base, amount: 500, discount: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects an external PDF link without a scheme", () => {
    const result = invoiceSchema.safeParse({ ...base, amount: 500, pdfExternalUrl: "not-a-link" });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed https external PDF link", () => {
    const result = invoiceSchema.safeParse({
      ...base,
      amount: 500,
      pdfExternalUrl: "https://drive.google.com/file/1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a billToEmail that isn't a valid email", () => {
    const result = invoiceSchema.safeParse({ ...base, amount: 500, billToEmail: "nope" });
    expect(result.success).toBe(false);
  });

  it("rejects payment terms outside the supported range", () => {
    const result = invoiceSchema.safeParse({ ...base, amount: 500, paymentTermsDays: 400 });
    expect(result.success).toBe(false);
  });

  it("rejects a line item with zero or negative quantity", () => {
    const result = invoiceSchema.safeParse({
      ...base,
      amount: 0,
      items: [{ description: "Design", qty: 0, rate: 500 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown invoice status", () => {
    const result = invoiceSchema.safeParse({ ...base, amount: 500, status: "DRAFT" });
    expect(result.success).toBe(false);
  });
});
