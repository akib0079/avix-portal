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

export const audienceFilterSchema = z.object({
  audience: z.enum(["clients", "leads", "both"]).default("both"),
  search: z.string().trim().max(120).optional(),
  stages: z.array(z.enum(["NEW", "CONTACTED", "PROPOSAL", "WON", "LOST"])).optional(),
  sources: z
    .array(z.enum(["FIVERR", "UPWORK", "REFERRAL", "WEBSITE", "OTHER"]))
    .optional(),
  hasActiveProject: z.boolean().optional(),
});

export type AudienceFilterInput = z.infer<typeof audienceFilterSchema>;

export const segmentSchema = z.object({
  name: z.string().trim().min(1, "Name this segment").max(80),
  filter: audienceFilterSchema,
});

export type SegmentInput = z.infer<typeof segmentSchema>;
