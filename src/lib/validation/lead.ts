import { z } from "zod";
import type { LeadStage, LeadSource } from "@prisma/client";

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
});

export type LeadInput = z.infer<typeof leadSchema>;
