import { z } from "zod";
import { pricingFields } from "@/lib/validation/milestone";

export const taskRequestSchema = z.object({
  projectId: z.string().min(1, "Select a project"),
  title: z.string().trim().min(1, "Title is required").max(160),
  description: z.unknown(),
});

export type TaskRequestInput = z.infer<typeof taskRequestSchema>;

type PricingValues = {
  pricingType: "NONE" | "HOURLY" | "FIXED";
  hourlyRate?: number | null;
  fixedPrice?: number | null;
};

function checkPricing(val: PricingValues, ctx: z.RefinementCtx) {
  if (val.pricingType === "HOURLY" && (val.hourlyRate == null || val.hourlyRate <= 0)) {
    ctx.addIssue({ code: "custom", path: ["hourlyRate"], message: "Enter an hourly rate" });
  }
  if (val.pricingType === "FIXED" && (val.fixedPrice == null || val.fixedPrice <= 0)) {
    ctx.addIssue({ code: "custom", path: ["fixedPrice"], message: "Enter a fixed price" });
  }
}

/** Pricing set by the admin at approval time. */
export const approvalPricingSchema = z.object(pricingFields).superRefine(checkPricing);

export type ApprovalPricingInput = z.infer<typeof approvalPricingSchema>;

/**
 * Accepting a client's request: its price (ADMIN only — STAFF may accept work
 * only as no charge), where it starts, and optionally who does it, by when,
 * and under which phase. Everything but the price may be left out.
 */
export const acceptRequestSchema = z
  .object({
    ...pricingFields,
    stage: z.enum(["BACKLOG", "TODO", "IN_PROGRESS"]).default("TODO"),
    assigneeId: z.string().nullable().optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date")
      .nullable()
      .optional(),
    parentId: z.string().nullable().optional(),
  })
  .superRefine(checkPricing);

export type AcceptRequestInput = z.input<typeof acceptRequestSchema>;

export const rejectSchema = z.object({
  reason: z.string().trim().min(3, "Give the client a short reason").max(1000),
});
