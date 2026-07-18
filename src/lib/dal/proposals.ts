import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import type { Prisma, ProposalStatus, ProjectType } from "@prisma/client";

export type ProposalItemView = {
  id: string;
  description: string;
  amount: number;
  sortOrder: number;
};

/** Full proposal for the admin list — carries everything the builder needs to edit in place. */
export type ProposalView = {
  id: string;
  title: string;
  intro: string | null;
  projectType: ProjectType;
  timelineWeeks: number | null;
  depositPercent: number;
  expiresInDays: number;
  status: ProposalStatus;
  total: number;
  /** null for manually-created proposals (no lead behind them). */
  leadId: string | null;
  /** Raw manual fields, for re-editing a manual proposal. */
  recipientName: string | null;
  recipientEmail: string | null;
  recipientCompany: string | null;
  /** Effective recipient — from the lead, or the manual fields. */
  contactName: string;
  contactEmail: string | null;
  contactCompany: string | null;
  expiresAt: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  acceptedName: string | null;
  acceptedByAdmin: boolean;
  convertedClientId: string | null;
  convertedProjectId: string | null;
  convertedInvoiceId: string | null;
  createdAt: string;
  items: ProposalItemView[];
};

/** Read-only slice safe to render on the public accept page (no admin data). */
export type PublicProposalView = {
  id: string;
  title: string;
  intro: string | null;
  timelineWeeks: number | null;
  depositPercent: number;
  status: ProposalStatus;
  expiresAt: string | null;
  acceptedAt: string | null;
  acceptedName: string | null;
  total: number;
  depositAmount: number;
  items: ProposalItemView[];
  contactName: string;
  contactCompany: string | null;
};

type ItemRow = { id: string; description: string; amount: Prisma.Decimal; sortOrder: number };

function toItemView(i: ItemRow): ProposalItemView {
  return { id: i.id, description: i.description, amount: Number(i.amount), sortOrder: i.sortOrder };
}

function sumItems(items: ItemRow[]): number {
  return items.reduce((acc, i) => acc + Number(i.amount), 0);
}

type RecipientSource = {
  lead: { name: string; company: string | null; email: string | null } | null;
  recipientName: string | null;
  recipientEmail: string | null;
  recipientCompany: string | null;
};

/**
 * The effective recipient: a pipeline lead when there is one, otherwise the
 * manually-entered fields. Exactly one of the two is set by the actions layer.
 */
export function proposalContact(p: RecipientSource) {
  return {
    name: p.lead?.name ?? p.recipientName ?? "Unknown",
    email: p.lead?.email ?? p.recipientEmail ?? null,
    company: p.lead?.company ?? p.recipientCompany ?? null,
  };
}

export async function listProposals(): Promise<ProposalView[]> {
  await requireAdmin();
  const rows = await prisma.proposal.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      lead: { select: { name: true, company: true, email: true } },
    },
  });
  return rows.map((p) => {
    const contact = proposalContact(p);
    return {
      id: p.id,
      title: p.title,
      intro: p.intro,
      projectType: p.projectType,
      timelineWeeks: p.timelineWeeks,
      depositPercent: p.depositPercent,
      expiresInDays: p.expiresInDays,
      status: p.status,
      total: sumItems(p.items),
      leadId: p.leadId,
      recipientName: p.recipientName,
      recipientEmail: p.recipientEmail,
      recipientCompany: p.recipientCompany,
      contactName: contact.name,
      contactEmail: contact.email,
      contactCompany: contact.company,
      expiresAt: p.expiresAt?.toISOString() ?? null,
      sentAt: p.sentAt?.toISOString() ?? null,
      acceptedAt: p.acceptedAt?.toISOString() ?? null,
      acceptedName: p.acceptedName,
      acceptedByAdmin: p.acceptedByAdmin,
      convertedClientId: p.convertedClientId,
      convertedProjectId: p.convertedProjectId,
      convertedInvoiceId: p.convertedInvoiceId,
      createdAt: p.createdAt.toISOString(),
      items: p.items.map(toItemView),
    };
  });
}

/** No auth — the public page calls this only AFTER verifying the signed token. */
export async function getPublicProposal(id: string): Promise<PublicProposalView | null> {
  const p = await prisma.proposal.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      lead: { select: { name: true, company: true, email: true } },
    },
  });
  if (!p) return null;
  const total = sumItems(p.items);
  const contact = proposalContact(p);
  return {
    id: p.id,
    title: p.title,
    intro: p.intro,
    timelineWeeks: p.timelineWeeks,
    depositPercent: p.depositPercent,
    status: p.status,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    acceptedAt: p.acceptedAt?.toISOString() ?? null,
    acceptedName: p.acceptedName,
    total,
    depositAmount: Math.round(total * p.depositPercent) / 100,
    items: p.items.map(toItemView),
    contactName: contact.name,
    contactCompany: contact.company,
  };
}
