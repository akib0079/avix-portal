import { z } from "zod";
import type { ProposalStatus } from "@prisma/client";
import { projectTypeValues } from "@/lib/validation/project";

export const proposalStatusValues = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
] as const;

export const proposalStatusLabels: Record<ProposalStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
};

export const proposalItemSchema = z.object({
  description: z.string().trim().min(1, "Describe this line item").max(200),
  amount: z.number().min(0, "Amount can't be negative").max(9999999),
});

/** Where the recipient comes from: an existing pipeline lead, or typed in by hand. */
export const proposalSourceValues = ["lead", "manual"] as const;

export const proposalSchema = z
  .object({
    source: z.enum(proposalSourceValues),
    // Required when source === "lead"
    leadId: z.string().optional().or(z.literal("")),
    // Required when source === "manual"
    recipientName: z.string().trim().max(160).optional().or(z.literal("")),
    recipientEmail: z
      .string()
      .trim()
      .email("Enter a valid email")
      .max(255)
      .optional()
      .or(z.literal("")),
    recipientCompany: z.string().trim().max(160).optional().or(z.literal("")),
    title: z.string().trim().min(1, "Title is required").max(160),
    intro: z.string().trim().max(5000).optional().or(z.literal("")),
    projectType: z.enum(projectTypeValues),
    timelineWeeks: z.number().int().min(1).max(104).nullable().optional(),
    depositPercent: z.number().int().min(0).max(100),
    expiresInDays: z.number().int().min(1).max(120),
    items: z.array(proposalItemSchema).min(1, "Add at least one line item"),
  })
  .superRefine((val, ctx) => {
    if (val.source === "lead") {
      if (!val.leadId) {
        ctx.addIssue({ code: "custom", path: ["leadId"], message: "Pick a lead" });
      }
      return;
    }
    if (!val.recipientName) {
      ctx.addIssue({
        code: "custom",
        path: ["recipientName"],
        message: "Who is this proposal for?",
      });
    }
    // The email is the accept-link destination and becomes their login.
    if (!val.recipientEmail) {
      ctx.addIssue({
        code: "custom",
        path: ["recipientEmail"],
        message: "An email is required — the proposal is sent to it",
      });
    }
  });

export type ProposalInput = z.infer<typeof proposalSchema>;
export type ProposalItemInput = z.infer<typeof proposalItemSchema>;

/** Public accept step: the prospect types their full name as an e-signature. */
export const acceptProposalSchema = z.object({
  signedName: z.string().trim().min(2, "Type your full name").max(120),
});
