import { z } from "zod";

export const projectTypeValues = [
  "SHOPIFY",
  "WORDPRESS",
  "WEBFLOW",
  "CUSTOM_WEB_DEV",
  "APP_DEV",
  "UI_DESIGN_FIGMA",
] as const;

export const projectSourceValues = ["FIVERR", "UPWORK", "INDEPENDENT", "DEED"] as const;
export const priorityValues = ["HIGH", "MEDIUM", "LOW"] as const;
export const projectStatusValues = ["PLANNING", "IN_PROGRESS", "REVIEW", "COMPLETED"] as const;
export const billingTypeValues = ["MILESTONE", "CONTRACT"] as const;

export const projectSchema = z
  .object({
    projectName: z.string().trim().min(1, "Project name is required").max(160),
    // "none" = independent project (no client)
    clientId: z.string().min(1),
    type: z.enum(projectTypeValues),
    source: z.enum(projectSourceValues),
    priority: z.enum(priorityValues),
    status: z.enum(projectStatusValues),
    billingType: z.enum(billingTypeValues),
    contractPrice: z.number().min(0).max(9999999).nullable().optional(),
    description: z.unknown().optional(),
    startDate: z.string().optional().or(z.literal("")),
    dueDate: z.string().optional().or(z.literal("")),
  })
  .superRefine((val, ctx) => {
    if (
      val.billingType === "CONTRACT" &&
      (val.contractPrice == null || val.contractPrice <= 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["contractPrice"],
        message: "Enter the contract price",
      });
    }
  });

export type ProjectInput = z.infer<typeof projectSchema>;
