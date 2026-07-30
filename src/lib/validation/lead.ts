import { z } from "zod";
import type { LeadStage, LeadSource, LeadEntryKind } from "@prisma/client";

export const leadStageValues = ["NEW", "CONTACTED", "PROPOSAL", "WON", "LOST"] as const;
export const leadSourceValues = ["FIVERR", "UPWORK", "REFERRAL", "WEBSITE", "OTHER"] as const;

export const leadStageLabels: Record<LeadStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  PROPOSAL: "Proposal sent",
  WON: "Won",
  LOST: "Lost",
};

export const leadSourceLabels: Record<LeadSource, string> = {
  FIVERR: "Fiverr",
  UPWORK: "Upwork",
  REFERRAL: "Referral",
  WEBSITE: "Website",
  OTHER: "Other",
};

export const leadEntryKindValues = ["NOTE", "CALL", "EMAIL", "MEETING", "STAGE"] as const;

export const leadEntryKindLabels: Record<LeadEntryKind, string> = {
  NOTE: "Note",
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
  STAGE: "Stage change",
};

export const leadPriorityValues = ["HIGH", "MEDIUM", "LOW"] as const;

/** One entry in a lead's contact log. STAGE entries are written by the server. */
export const leadEntrySchema = z.object({
  kind: z.enum(["NOTE", "CALL", "EMAIL", "MEETING"]),
  body: z.string().trim().min(1, "Write something first").max(4000),
});

export type LeadEntryInput = z.infer<typeof leadEntrySchema>;

export const leadSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  email: z.string().trim().email("Enter a valid email").max(255).optional().or(z.literal("")),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  source: z.enum(leadSourceValues),
  stage: z.enum(leadStageValues),
  estimatedValue: z.number().min(0).max(9999999).nullable().optional(),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
  brandInfo: z.string().trim().max(4000).optional().or(z.literal("")),
  responseMessage: z.string().trim().max(8000).optional().or(z.literal("")),
  nextFollowUp: z.string().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  ownerId: z.string().optional().or(z.literal("")),
  priority: z.enum(leadPriorityValues),
  expectedCloseDate: z.string().optional().or(z.literal("")),
  /** Comma-separated in the form; normalised to an array by the action. */
  tags: z.string().trim().max(300).optional().or(z.literal("")),
});

export type LeadInput = z.infer<typeof leadSchema>;
