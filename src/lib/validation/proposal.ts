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

export const proposalSchema = z.object({
  leadId: z.string().min(1),
  title: z.string().trim().min(1, "Title is required").max(160),
  intro: z.string().trim().max(5000).optional().or(z.literal("")),
  projectType: z.enum(projectTypeValues),
  timelineWeeks: z.number().int().min(1).max(104).nullable().optional(),
  depositPercent: z.number().int().min(0).max(100),
  expiresInDays: z.number().int().min(1).max(120),
  items: z.array(proposalItemSchema).min(1, "Add at least one line item"),
});

export type ProposalInput = z.infer<typeof proposalSchema>;
export type ProposalItemInput = z.infer<typeof proposalItemSchema>;

/** Public accept step: the prospect types their full name as an e-signature. */
export const acceptProposalSchema = z.object({
  signedName: z.string().trim().min(2, "Type your full name").max(120),
});
