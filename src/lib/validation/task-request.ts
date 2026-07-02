import { z } from "zod";
import { pricingFields } from "@/lib/validation/milestone";

export const taskRequestSchema = z.object({
  projectId: z.string().min(1, "Select a project"),
  title: z.string().trim().min(1, "Title is required").max(160),
  description: z.unknown(),
});

export type TaskRequestInput = z.infer<typeof taskRequestSchema>;

/** Pricing set by the admin at approval time. */
export const approvalPricingSchema = z
  .object(pricingFields)
  .superRefine((val, ctx) => {
    if (val.pricingType === "HOURLY" && (val.hourlyRate == null || val.hourlyRate <= 0)) {
      ctx.addIssue({ code: "custom", path: ["hourlyRate"], message: "Enter an hourly rate" });
    }
    if (val.pricingType === "FIXED" && (val.fixedPrice == null || val.fixedPrice <= 0)) {
      ctx.addIssue({ code: "custom", path: ["fixedPrice"], message: "Enter a fixed price" });
    }
  });

export type ApprovalPricingInput = z.infer<typeof approvalPricingSchema>;

export const rejectSchema = z.object({
  reason: z.string().trim().min(3, "Give the client a short reason").max(1000),
});
