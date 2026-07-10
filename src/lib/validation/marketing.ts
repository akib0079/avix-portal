import { z } from "zod";

export const emailTemplateSchema = z
  .object({
    name: z.string().trim().min(1, "Template name is required").max(120),
    subject: z.string().trim().min(1, "Subject is required").max(200),
    body: z.unknown().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.body == null) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "Write the email content" });
    }
  });

export type EmailTemplateInput = z.infer<typeof emailTemplateSchema>;

export const campaignSchema = z
  .object({
    subject: z.string().trim().min(1, "Subject is required").max(200),
    body: z.unknown().optional(),
    templateId: z.string().optional().or(z.literal("")),
    recipientIds: z.array(z.string().min(1)).min(1, "Pick at least one recipient"),
  })
  .superRefine((val, ctx) => {
    if (val.body == null) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "Write the email content" });
    }
  });

export type CampaignInput = z.infer<typeof campaignSchema>;
