import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import type { Lead, LeadStage, LeadSource, Priority, LeadEntryKind } from "@prisma/client";

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
  phone: string | null;
  ownerId: string | null;
  ownerName: string | null;
  priority: Priority;
  expectedCloseDate: string | null; // "YYYY-MM-DD"
  lostReason: string | null;
  tags: string[];
  convertedClientId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A lead + everything the detail page renders. */
export type LeadDetail = LeadView & {
  entries: LeadEntryView[];
  proposals: { id: string; title: string; status: string; total: number }[];
};

export type LeadEntryView = {
  id: string;
  kind: LeadEntryKind;
  body: string;
  authorName: string | null;
  createdAt: string;
};

export type LeadOwnerOption = { id: string; name: string };

type LeadWithOwner = Lead & { owner?: { firstName: string; lastName: string } | null };

export function toLeadView(lead: LeadWithOwner): LeadView {
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
    phone: lead.phone,
    ownerId: lead.ownerId,
    ownerName: lead.owner
      ? `${lead.owner.firstName} ${lead.owner.lastName}`.trim() || null
      : null,
    priority: lead.priority,
    expectedCloseDate: lead.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
    lostReason: lead.lostReason,
    tags: lead.tags,
    convertedClientId: lead.convertedClientId,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

export async function listLeads(): Promise<LeadView[]> {
  await requireAdmin();
  const rows = await prisma.lead.findMany({
    orderBy: [{ nextFollowUp: "asc" }, { createdAt: "desc" }],
    include: { owner: { select: { firstName: true, lastName: true } } },
  });
  return rows.map(toLeadView);
}

/** One lead with its contact log and proposals — powers /admin/leads/[id]. */
export async function getLead(id: string): Promise<LeadDetail | null> {
  await requireAdmin();
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      owner: { select: { firstName: true, lastName: true } },
      entries: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { firstName: true, lastName: true } } },
      },
      proposals: {
        orderBy: { createdAt: "desc" },
        include: { items: { select: { amount: true } } },
      },
    },
  });
  if (!lead) return null;

  return {
    ...toLeadView(lead),
    entries: lead.entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      body: e.body,
      authorName: e.author
        ? `${e.author.firstName} ${e.author.lastName}`.trim() || null
        : null,
      createdAt: e.createdAt.toISOString(),
    })),
    proposals: lead.proposals.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      total: p.items.reduce((sum, i) => sum + Number(i.amount), 0),
    })),
  };
}

/** Team members who can own a lead (admins + staff). */
export async function listLeadOwners(): Promise<LeadOwnerOption[]> {
  await requireAdmin();
  const rows = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "STAFF"] }, status: "ACTIVE" },
    orderBy: { firstName: "asc" },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  return rows.map((u) => ({
    id: u.id,
    name: `${u.firstName} ${u.lastName}`.trim() || u.email,
  }));
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
