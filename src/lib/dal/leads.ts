import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import type { Lead, LeadStage, LeadSource } from "@prisma/client";

/** Serialized lead safe for client components (no Decimal/Date). */
export type LeadView = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  source: LeadSource;
  stage: LeadStage;
  estimatedValue: number | null;
  notes: string | null;
  brandInfo: string | null;
  responseMessage: string | null;
  nextFollowUp: string | null; // "YYYY-MM-DD"
  convertedClientId: string | null;
};

export function toLeadView(lead: Lead): LeadView {
  return {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    company: lead.company,
    source: lead.source,
    stage: lead.stage,
    estimatedValue: lead.estimatedValue == null ? null : Number(lead.estimatedValue),
    notes: lead.notes,
    brandInfo: lead.brandInfo,
    responseMessage: lead.responseMessage,
    nextFollowUp: lead.nextFollowUp?.toISOString().slice(0, 10) ?? null,
    convertedClientId: lead.convertedClientId,
  };
}

export async function listLeads(): Promise<LeadView[]> {
  await requireAdmin();
  const rows = await prisma.lead.findMany({
    orderBy: [{ nextFollowUp: "asc" }, { createdAt: "desc" }],
  });
  return rows.map(toLeadView);
}

/** Open leads + overdue follow-ups, for the dashboard pipeline card. */
export async function getPipelineSummary() {
  await requireAdmin();
  const [open, overdue] = await Promise.all([
    prisma.lead.count({ where: { stage: { in: ["NEW", "CONTACTED", "PROPOSAL"] } } }),
    prisma.lead.count({
      where: {
        stage: { in: ["NEW", "CONTACTED", "PROPOSAL"] },
        nextFollowUp: { lt: new Date() },
      },
    }),
  ]);
  return { open, overdue };
}
