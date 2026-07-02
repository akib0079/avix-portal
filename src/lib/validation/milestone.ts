import { z } from "zod";

export const pricingFields = {
  pricingType: z.enum(["NONE", "HOURLY", "FIXED"]),
  hourlyRate: z.number().min(0).max(99999).nullable().optional(),
  estimatedHours: z.number().min(0).max(9999).nullable().optional(),
  fixedPrice: z.number().min(0).max(9999999).nullable().optional(),
};

export const milestoneSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(160),
    description: z.unknown().optional(),
    ...pricingFields,
  })
  .superRefine((val, ctx) => {
    if (val.pricingType === "HOURLY" && (val.hourlyRate == null || val.hourlyRate <= 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["hourlyRate"],
        message: "Enter an hourly rate",
      });
    }
    if (val.pricingType === "FIXED" && (val.fixedPrice == null || val.fixedPrice <= 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["fixedPrice"],
        message: "Enter a fixed price",
      });
    }
  });

export type MilestoneInput = z.infer<typeof milestoneSchema>;
