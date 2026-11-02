import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptRequestSchema, approvalPricingSchema } from "./task-request";

test("an accept that names no price is valid, and leaves every field out but the stage", () => {
  const parsed = acceptRequestSchema.safeParse({ stage: "IN_PROGRESS" });
  assert.equal(parsed.success, true);
  // Left out = keep: nothing is filled in on the server's behalf.
  assert.deepEqual(parsed.data, { stage: "IN_PROGRESS" });
  assert.deepEqual(acceptRequestSchema.parse({}), { stage: "TODO" });
});

test("an accept that names a price is still checked like one", () => {
  assert.equal(acceptRequestSchema.safeParse({ pricingType: "FIXED" }).success, false);
  assert.equal(acceptRequestSchema.safeParse({ pricingType: "HOURLY", hourlyRate: 0 }).success, false);
  assert.equal(acceptRequestSchema.safeParse({ pricingType: "FIXED", fixedPrice: 1500 }).success, true);
  assert.equal(acceptRequestSchema.safeParse({ pricingType: "NONE" }).success, true);
  // A rate without a type changes nothing, so it isn't an error either.
  assert.equal(acceptRequestSchema.safeParse({ hourlyRate: 80 }).success, true);
});

test("the pick fields keep null (clear) apart from absent (keep)", () => {
  const cleared = acceptRequestSchema.parse({ assigneeId: null, dueDate: null, parentId: null });
  assert.deepEqual(cleared, { stage: "TODO", assigneeId: null, dueDate: null, parentId: null });
  assert.equal(acceptRequestSchema.safeParse({ dueDate: "20 Nov" }).success, false);
});

test("the drawer's price editor still needs a type", () => {
  assert.equal(approvalPricingSchema.safeParse({}).success, false);
  assert.equal(approvalPricingSchema.safeParse({ pricingType: "NONE" }).success, true);
});
