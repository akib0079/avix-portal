import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import {
  firstInvoicePromise,
  proposalRemovalPlan,
  type DraftInvoiceFacts,
  type FirstInvoicePromise,
  type ProposalRemovalPlan,
} from "@/lib/proposal-rules";
import type {
  InvoiceStatus,
  LeadStage,
  Prisma,
  ProposalEventType,
  ProposalStatus,
  ProjectType,
} from "@prisma/client";
import type { CurrencyCode } from "@/lib/currency";

export type ProposalItemView = {
  id: string;
  description: string;
  amount: number;
  sortOrder: number;
};

/**
 * One card on the proposals board: what the card and its menu need, and
 * nothing the builder does. The builder's data (every line, the draft
 * invoice) loads when it opens, so the board is a single light query.
 */
export type ProposalCard = {
  id: string;
  title: string;
  status: ProposalStatus;
  currency: CurrencyCode;
  total: number;
  depositPercent: number;
  /** null for manually-created proposals (no lead behind them). */
  leadId: string | null;
  leadStage: LeadStage | null;
  /** Effective recipient — from the lead, or the manual fields. */
  contactName: string;
  contactEmail: string | null;
  contactCompany: string | null;
  /** The invoice document attached in the builder, if any. */
  attachment: "file" | "link" | null;
  expiresAt: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  acceptedName: string | null;
  acceptedByAdmin: boolean;
  declinedAt: string | null;
  declineReason: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  remindersEnabled: boolean;
  archivedAt: string | null;
  convertedProjectId: string | null;
  convertedInvoiceId: string | null;
  createdAt: string;
};

export type ProposalBoard = {
  /** Open proposals in full; closed ones that changed within `closedDays`. */
  proposals: ProposalCard[];
  /** Live (non-archived) proposals per status, so a capped lane can say what it hides. */
  counts: Record<ProposalStatus, number>;
  /**
   * Live totals per status and currency, over every proposal rather than the
   * cards loaded, so a capped lane's total (and the "won" figure) is still
   * the whole truth. Never summed across currencies.
   */
  totals: Record<ProposalStatus, { code: string; total: number }[]>;
  archivedCount: number;
  /** How far back the closed lanes reach; null = all of them. */
  closedDays: number | null;
};

/** The draft invoice created alongside a proposal, as step 2 of the builder edits it. */
export type ProposalInvoiceDraft = {
  title: string | null;
  currency: CurrencyCode;
  paymentAccountId: string | null;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  notes: string | null;
  billToCompany: string | null;
  billToAddress: string | null;
  billToEmail: string | null;
  items: { description: string; qty: number; rate: number }[];
};

/** Everything the builder needs to edit a proposal in place. */
export type ProposalDraft = {
  id: string;
  status: ProposalStatus;
  leadId: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  recipientCompany: string | null;
  title: string;
  intro: string | null;
  terms: string | null;
  currency: CurrencyCode;
  projectType: ProjectType;
  timelineWeeks: number | null;
  depositPercent: number;
  expiresInDays: number;
  invoicePdfPath: string | null;
  invoicePdfOriginalName: string | null;
  invoicePdfExternalUrl: string | null;
  items: { description: string; amount: number }[];
  invoice: ProposalInvoiceDraft | null;
};

export type ProposalEventView = {
  id: string;
  type: ProposalEventType;
  createdAt: string;
  /** The decline reason, the new expiry, the invoice removed with an archive… */
  meta: Record<string, unknown> | null;
};

/** The invoice behind a proposal, as the detail view and the delete dialog describe it. */
export type ProposalInvoiceSummary = {
  id: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  sentAt: string | null;
  amountPaid: number;
  paymentCount: number;
};

/** One proposal, opened: the detail sheet and the delete / accept dialogs. */
export type ProposalDetail = ProposalCard & {
  intro: string | null;
  terms: string | null;
  projectType: ProjectType;
  timelineWeeks: number | null;
  firstViewedAt: string | null;
  items: ProposalItemView[];
  events: ProposalEventView[];
  invoice: ProposalInvoiceSummary | null;
  projectName: string | null;
  /** The account the proposal is provisioned for; hasLogin = the invite was completed. */
  client: { id: string; name: string; email: string; hasLogin: boolean } | null;
  /** What Delete would do, and whether it may take the invoice along. */
  removal: ProposalRemovalPlan;
  /** What the client is told they will be invoiced first. */
  firstInvoice: FirstInvoicePromise;
};

/** Read-only slice safe to render on the public page (no admin data). */
export type PublicProposalView = {
  id: string;
  title: string;
  intro: string | null;
  terms: string | null;
  currency: CurrencyCode;
  timelineWeeks: number | null;
  depositPercent: number;
  status: ProposalStatus;
  linkVersion: number;
  archived: boolean;
  expiresAt: string | null;
  acceptedAt: string | null;
  acceptedName: string | null;
  declinedAt: string | null;
  total: number;
  firstInvoice: FirstInvoicePromise;
  /** The client already has a portal login (so no invite email after accepting). */
  portalReady: boolean;
  items: ProposalItemView[];
  contactName: string;
  contactCompany: string | null;
};

type ItemRow = { id: string; description: string; amount: Prisma.Decimal; sortOrder: number };

function toItemView(i: ItemRow): ProposalItemView {
  return { id: i.id, description: i.description, amount: Number(i.amount), sortOrder: i.sortOrder };
}

function sumItems(items: { amount: Prisma.Decimal }[]): number {
  return Math.round(items.reduce((acc, i) => acc + Number(i.amount), 0) * 100) / 100;
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

/** Proposals still waiting on someone; shown in full. */
export const OPEN_PROPOSAL_STATUSES = ["DRAFT", "SENT"] as const satisfies readonly ProposalStatus[];
/** Finished ones only grow, so the board shows the newest and offers more. */
export const CLOSED_PROPOSAL_STATUSES = ["ACCEPTED", "DECLINED", "EXPIRED"] as const satisfies readonly ProposalStatus[];

const CARD_SELECT = {
  id: true,
  title: true,
  status: true,
  currency: true,
  depositPercent: true,
  leadId: true,
  recipientName: true,
  recipientEmail: true,
  recipientCompany: true,
  invoicePdfPath: true,
  invoicePdfExternalUrl: true,
  expiresAt: true,
  sentAt: true,
  acceptedAt: true,
  acceptedName: true,
  acceptedByAdmin: true,
  declinedAt: true,
  declineReason: true,
  viewCount: true,
  lastViewedAt: true,
  remindersEnabled: true,
  archivedAt: true,
  convertedProjectId: true,
  convertedInvoiceId: true,
  createdAt: true,
  items: { select: { amount: true } },
  lead: { select: { name: true, company: true, email: true, stage: true } },
} satisfies Prisma.ProposalSelect;

type CardRow = Prisma.ProposalGetPayload<{ select: typeof CARD_SELECT }>;

function toCard(p: CardRow): ProposalCard {
  const contact = proposalContact(p);
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    currency: p.currency,
    total: sumItems(p.items),
    depositPercent: p.depositPercent,
    leadId: p.leadId,
    leadStage: p.lead?.stage ?? null,
    contactName: contact.name,
    contactEmail: contact.email,
    contactCompany: contact.company,
    attachment: p.invoicePdfExternalUrl ? "link" : p.invoicePdfPath ? "file" : null,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    sentAt: p.sentAt?.toISOString() ?? null,
    acceptedAt: p.acceptedAt?.toISOString() ?? null,
    acceptedName: p.acceptedName,
    acceptedByAdmin: p.acceptedByAdmin,
    declinedAt: p.declinedAt?.toISOString() ?? null,
    declineReason: p.declineReason,
    viewCount: p.viewCount,
    lastViewedAt: p.lastViewedAt?.toISOString() ?? null,
    remindersEnabled: p.remindersEnabled,
    archivedAt: p.archivedAt?.toISOString() ?? null,
    convertedProjectId: p.convertedProjectId,
    convertedInvoiceId: p.convertedInvoiceId,
    createdAt: p.createdAt.toISOString(),
  };
}

const ZERO_COUNTS: Record<ProposalStatus, number> = {
  DRAFT: 0,
  SENT: 0,
  ACCEPTED: 0,
  DECLINED: 0,
  EXPIRED: 0,
};

/**
 * The board, in one wave of two statements: every open proposal, the closed
 * ones that changed within `closedDays` (they only ever accumulate, so the
 * lanes hold the recent ones and offer the rest), and per-lane counts and
 * totals over everything. The archive is its own view, never mixed into the
 * lanes.
 */
export async function listProposalBoard(opts: {
  archived: boolean;
  closedDays: number | null;
}): Promise<ProposalBoard> {
  await requireAdmin();
  const cutoff =
    opts.closedDays == null ? null : new Date(Date.now() - opts.closedDays * 24 * 60 * 60 * 1000);

  const countsQuery = prisma.$queryRaw<
    { status: ProposalStatus; archived: boolean; currency: string; n: number; total: Prisma.Decimal | null }[]
  >`
    SELECT p.status::text AS status,
           (p."archivedAt" IS NOT NULL) AS archived,
           p.currency::text AS currency,
           COUNT(DISTINCT p.id)::int AS n,
           SUM(i.amount) AS total
    FROM proposals p
    LEFT JOIN proposal_items i ON i."proposalId" = p.id
    GROUP BY 1, 2, 3`;

  const [rows, countRows] = await Promise.all([
    opts.archived
      ? prisma.proposal.findMany({
          where: { archivedAt: { not: null } },
          orderBy: { archivedAt: "desc" },
          take: 200,
          select: CARD_SELECT,
        })
      : prisma.proposal.findMany({
          where: {
            archivedAt: null,
            OR: [
              { status: { in: [...OPEN_PROPOSAL_STATUSES] } },
              {
                status: { in: [...CLOSED_PROPOSAL_STATUSES] },
                ...(cutoff ? { updatedAt: { gte: cutoff } } : {}),
              },
            ],
          },
          orderBy: { createdAt: "desc" },
          // A ceiling, not a page size: no lane should ever come near it.
          take: 1000,
          select: CARD_SELECT,
        }),
    countsQuery,
  ]);

  const counts = { ...ZERO_COUNTS };
  const totals: ProposalBoard["totals"] = {
    DRAFT: [],
    SENT: [],
    ACCEPTED: [],
    DECLINED: [],
    EXPIRED: [],
  };
  let archivedCount = 0;
  for (const row of countRows) {
    if (row.archived) {
      archivedCount += row.n;
      continue;
    }
    counts[row.status] += row.n;
    const total = Math.round(Number(row.total ?? 0) * 100) / 100;
    if (total > 0) totals[row.status].push({ code: row.currency, total });
  }
  for (const list of Object.values(totals)) list.sort((a, b) => b.total - a.total);

  return {
    proposals: rows.map(toCard),
    counts,
    totals,
    archivedCount,
    closedDays: opts.closedDays,
  };
}

/** One card, for a deep link to a proposal the board didn't load (archived, or older). */
export async function getProposalCard(id: string): Promise<ProposalCard | null> {
  await requireAdmin();
  const row = await prisma.proposal.findUnique({ where: { id }, select: CARD_SELECT });
  return row ? toCard(row) : null;
}

/**
 * The references a proposal keeps without foreign keys (its invoice, project
 * and client), read in ONE statement. Prisma can't join them, and reading the
 * proposal first to learn the ids would put a second round trip in front of
 * every caller; this runs beside the proposal read instead.
 *
 * No auth: callers have already authorised (admin session or a valid link).
 */
export async function proposalLinks(id: string) {
  const rows = await prisma.$queryRaw<
    {
      invoiceId: string | null;
      invoiceNumber: string | null;
      invoiceAmount: Prisma.Decimal | null;
      invoiceCurrency: string | null;
      invoiceStatus: InvoiceStatus | null;
      invoiceSentAt: Date | null;
      invoiceAmountPaid: Prisma.Decimal | null;
      invoicePaymentCount: number | null;
      projectName: string | null;
      clientId: string | null;
      clientEmail: string | null;
      clientName: string | null;
      clientFirstName: string | null;
      clientVerified: boolean | null;
    }[]
  >`
    SELECT
      i.id AS "invoiceId",
      i."invoiceNumber" AS "invoiceNumber",
      i.amount AS "invoiceAmount",
      i.currency::text AS "invoiceCurrency",
      i.status::text AS "invoiceStatus",
      i."sentAt" AS "invoiceSentAt",
      i."amountPaid" AS "invoiceAmountPaid",
      (SELECT COUNT(*)::int FROM invoice_payments ip WHERE ip."invoiceId" = i.id) AS "invoicePaymentCount",
      pr."projectName" AS "projectName",
      u.id AS "clientId",
      u.email AS "clientEmail",
      u.name AS "clientName",
      u."firstName" AS "clientFirstName",
      u."emailVerified" AS "clientVerified"
    FROM proposals p
    LEFT JOIN invoices i ON i.id = p."convertedInvoiceId"
    LEFT JOIN projects pr ON pr.id = p."convertedProjectId"
    LEFT JOIN users u ON u.id = p."convertedClientId"
    WHERE p.id = ${id}`;
  const row = rows[0];
  if (!row) return null;

  const invoice: ProposalInvoiceSummary | null =
    row.invoiceId && row.invoiceNumber && row.invoiceStatus
      ? {
          id: row.invoiceId,
          invoiceNumber: row.invoiceNumber,
          amount: Number(row.invoiceAmount ?? 0),
          currency: row.invoiceCurrency ?? "USD",
          status: row.invoiceStatus,
          sentAt: row.invoiceSentAt?.toISOString() ?? null,
          amountPaid: Number(row.invoiceAmountPaid ?? 0),
          paymentCount: row.invoicePaymentCount ?? 0,
        }
      : null;
  const client = row.clientId
    ? {
        id: row.clientId,
        email: row.clientEmail ?? "",
        name: row.clientName || row.clientFirstName || row.clientEmail || "Client",
        emailVerified: row.clientVerified ?? false,
      }
    : null;
  return { invoice, projectName: row.projectName, client };
}

export type ProposalLinks = NonNullable<Awaited<ReturnType<typeof proposalLinks>>>;

/** The invoice facts the removal rules need. */
export function invoiceFacts(invoice: ProposalInvoiceSummary | null): DraftInvoiceFacts | null {
  if (!invoice) return null;
  return {
    status: invoice.status,
    sentAt: invoice.sentAt,
    amountPaid: invoice.amountPaid,
    paymentCount: invoice.paymentCount,
  };
}

/** One proposal for the detail sheet and the delete / accept dialogs. */
export async function getProposalDetail(id: string): Promise<ProposalDetail | null> {
  await requireAdmin();
  const [p, links] = await Promise.all([
    prisma.proposal.findUnique({
      where: { id },
      select: {
        ...CARD_SELECT,
        intro: true,
        terms: true,
        projectType: true,
        timelineWeeks: true,
        firstViewedAt: true,
        items: { orderBy: { sortOrder: "asc" } },
        events: {
          orderBy: { createdAt: "desc" },
          take: 60,
          select: { id: true, type: true, createdAt: true, meta: true },
        },
      },
    }),
    proposalLinks(id),
  ]);
  if (!p || !links) return null;

  const card = toCard(p);
  return {
    ...card,
    intro: p.intro,
    terms: p.terms,
    projectType: p.projectType,
    timelineWeeks: p.timelineWeeks,
    firstViewedAt: p.firstViewedAt?.toISOString() ?? null,
    items: p.items.map(toItemView),
    events: p.events.map((e) => ({
      id: e.id,
      type: e.type,
      createdAt: e.createdAt.toISOString(),
      meta:
        e.meta && typeof e.meta === "object" && !Array.isArray(e.meta)
          ? (e.meta as Record<string, unknown>)
          : null,
    })),
    invoice: links.invoice,
    projectName: links.projectName,
    client: links.client
      ? {
          id: links.client.id,
          name: links.client.name,
          email: links.client.email,
          hasLogin: links.client.emailVerified,
        }
      : null,
    removal: proposalRemovalPlan(p, invoiceFacts(links.invoice)),
    firstInvoice: firstInvoicePromise(card, links.invoice),
  };
}

/** The builder's data, loaded when it opens rather than with the board. */
export async function getProposalDraft(id: string): Promise<ProposalDraft | null> {
  await requireAdmin();
  const p = await prisma.proposal.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!p) return null;
  const inv = p.convertedInvoiceId
    ? await prisma.invoice.findUnique({
        where: { id: p.convertedInvoiceId },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      })
    : null;

  return {
    id: p.id,
    status: p.status,
    leadId: p.leadId,
    recipientName: p.recipientName,
    recipientEmail: p.recipientEmail,
    recipientCompany: p.recipientCompany,
    title: p.title,
    intro: p.intro,
    terms: p.terms,
    currency: p.currency,
    projectType: p.projectType,
    timelineWeeks: p.timelineWeeks,
    depositPercent: p.depositPercent,
    expiresInDays: p.expiresInDays,
    invoicePdfPath: p.invoicePdfPath,
    invoicePdfOriginalName: p.invoicePdfOriginalName,
    invoicePdfExternalUrl: p.invoicePdfExternalUrl,
    items: p.items.map((i) => ({ description: i.description, amount: Number(i.amount) })),
    invoice: inv
      ? {
          title: inv.title,
          currency: inv.currency,
          paymentAccountId: inv.paymentAccountId,
          invoiceNumber: inv.invoiceNumber,
          issueDate: inv.issueDate.toISOString().slice(0, 10),
          dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null,
          notes: inv.notes,
          billToCompany: inv.billToCompany,
          billToAddress: inv.billToAddress,
          billToEmail: inv.billToEmail,
          items: inv.items.map((it) => ({
            description: it.description,
            qty: Number(it.qty),
            rate: Number(it.rate),
          })),
        }
      : null,
  };
}

/**
 * No auth — the public page calls this only AFTER the link's signature has
 * checked out. The invoice is read beside the proposal (see proposalLinks), so
 * the page costs one wave however the proposal is wired.
 */
export async function getPublicProposal(id: string): Promise<PublicProposalView | null> {
  const [p, links] = await Promise.all([
    prisma.proposal.findUnique({
      where: { id },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        lead: { select: { name: true, company: true, email: true } },
      },
    }),
    proposalLinks(id),
  ]);
  if (!p) return null;
  const total = sumItems(p.items);
  const contact = proposalContact(p);
  return {
    id: p.id,
    title: p.title,
    intro: p.intro,
    terms: p.terms,
    currency: p.currency,
    timelineWeeks: p.timelineWeeks,
    depositPercent: p.depositPercent,
    status: p.status,
    linkVersion: p.linkVersion,
    archived: p.archivedAt != null,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    acceptedAt: p.acceptedAt?.toISOString() ?? null,
    acceptedName: p.acceptedName,
    declinedAt: p.declinedAt?.toISOString() ?? null,
    total,
    firstInvoice: firstInvoicePromise(
      { total, currency: p.currency, depositPercent: p.depositPercent },
      links?.invoice ?? null,
    ),
    portalReady: links?.client?.emailVerified ?? false,
    items: p.items.map(toItemView),
    contactName: contact.name,
    contactCompany: contact.company,
  };
}
