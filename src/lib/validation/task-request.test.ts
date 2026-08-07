import { describe, it, expect } from "vitest";
import { taskRequestSchema, approvalPricingSchema, rejectSchema } from "./task-request";

describe("taskRequestSchema", () => {
  it("requires a project and a non-blank title", () => {
    expect(
      taskRequestSchema.safeParse({ projectId: "", title: "Fix header", description: null }).success,
    ).toBe(false);
    expect(
      taskRequestSchema.safeParse({ projectId: "p1", title: "  ", description: null }).success,
    ).toBe(false);
  });

  it("accepts any shape for description (rich-text JSON)", () => {
    const result = taskRequestSchema.safeParse({
      projectId: "p1",
      title: "Fix header",
      description: { type: "doc", content: [] },
    });
    expect(result.success).toBe(true);
  });
});

describe("approvalPricingSchema", () => {
  it("requires a positive hourly rate when pricingType is HOURLY", () => {
    const result = approvalPricingSchema.safeParse({ pricingType: "HOURLY", hourlyRate: 0 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Enter an hourly rate");
  });

  it("requires a positive fixed price when pricingType is FIXED", () => {
    const result = approvalPricingSchema.safeParse({ pricingType: "FIXED", fixedPrice: null });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Enter a fixed price");
  });

  it("requires nothing extra when pricingType is NONE", () => {
    const result = approvalPricingSchema.safeParse({ pricingType: "NONE" });
    expect(result.success).toBe(true);
  });

  it("accepts a valid hourly rate", () => {
    const result = approvalPricingSchema.safeParse({
      pricingType: "HOURLY",
      hourlyRate: 80,
      estimatedHours: 5,
    });
    expect(result.success).toBe(true);
  });
});

describe("rejectSchema", () => {
  it("requires at least a short reason so the client isn't left guessing", () => {
    expect(rejectSchema.safeParse({ reason: "no" }).success).toBe(false);
    expect(rejectSchema.safeParse({ reason: "" }).success).toBe(false);
  });

  it("accepts a reason of 3+ characters", () => {
    expect(rejectSchema.safeParse({ reason: "Out of scope for this retainer" }).success).toBe(true);
  });
});
