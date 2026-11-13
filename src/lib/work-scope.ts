import type { InvoiceStatus, Prisma } from "@prisma/client";
import { creditedTotal } from "@/lib/invoice-totals";

/**
 * Which work items count for what — defined once for every surface that
 * counts them: the per-project "Needs you" box and the admin attention strip
 * (through project-health.ts), the portal's action centre and its badge
 * (portal-actions.ts), progress bars and the dashboard.
 *
 * Each rule comes twice: as a Prisma filter, for counting in the database, and
 * as a predicate over items already loaded. They sit side by side so a change
 * to one is a change to both. Dependency-free (types and the pure invoice
 * sums only), so client components can use the predicates.
 */

type Itemish = {
  stage?: string;
  archivedAt?: string | Date | null;
  parentId?: string | null;
};

/**
 * The plan: accepted, live, top-level work — what "3 of 7 milestones done"
 * counts. Sub-items roll up into their phase, and a request isn't plan work
 * until it's accepted.
 */
export const PLAN_ITEM = {
  archivedAt: null,
  parentId: null,
  stage: { not: "REQUESTED" },
} satisfies Prisma.MilestoneWhereInput;

export function isPlanItem(item: Itemish): boolean {
  return !item.archivedAt && !item.parentId && item.stage !== "REQUESTED";
}

/** A client's request still waiting for the team's decision. */
export const OPEN_REQUEST = {
  archivedAt: null,
  stage: "REQUESTED",
} satisfies Prisma.MilestoneWhereInput;

export function isOpenRequest(item: Itemish): boolean {
  return !item.archivedAt && item.stage === "REQUESTED";
}

/** Work the team finished and sent for the client's check. */
export const AWAITING_REVIEW = {
  archivedAt: null,
  stage: "REVIEW",
} satisfies Prisma.MilestoneWhereInput;

export function isAwaitingReview(item: Itemish): boolean {
  return !item.archivedAt && item.stage === "REVIEW";
}

/** A question the team asked on the item that the client hasn't answered. */
export const TEAM_QUESTION = {
  archivedAt: null,
  comments: { some: { kind: "HELP", authorRole: "ADMIN", resolvedAt: null } },
} satisfies Prisma.MilestoneWhereInput;

export function hasTeamQuestion(item: Itemish & { openHelp: { team: number } }): boolean {
  return !item.archivedAt && item.openHelp.team > 0;
}

/**
 * Finished top-level work the client approved but hasn't rated. Rating asks
 * about a phase or a milestone, not every small task, and only once the
 * client has signed it off — work the team closed on its own doesn't nag.
 */
export const AWAITING_RATING = {
  archivedAt: null,
  parentId: null,
  stage: "DONE",
  clientApprovedAt: { not: null },
  clientRating: null,
} satisfies Prisma.MilestoneWhereInput;

export function isAwaitingRating(
  item: Itemish & { clientApprovedAt: string | Date | null; clientRating: number | null },
): boolean {
  return (
    !item.archivedAt &&
    !item.parentId &&
    item.stage === "DONE" &&
    !!item.clientApprovedAt &&
    item.clientRating == null
  );
}

/** How many items wait on the client, by reason. */
export function clientWaiting(
  items: (Itemish & {
    openHelp: { team: number };
    clientApprovedAt: string | Date | null;
    clientRating: number | null;
  })[],
): { review: number; questions: number; rating: number } {
  return {
    review: items.filter(isAwaitingReview).length,
    questions: items.filter(hasTeamQuestion).length,
    rating: items.filter(isAwaitingRating).length,
  };
}

/**
 * An invoice the client can act on: sent (or part-paid) with a balance, and
 * not yet reported paid. A draft, or an invoice created but not sent, is
 * never on the client's list — it isn't theirs to see yet, and a credit note
 * (also SENT) is money back, not a bill. Defined here with the work rules
 * because the portal's "needs you" lists count them together.
 *
 * The filter can't compare two columns, so "has a balance" is the
 * predicate's part: callers that count in the database select the amounts
 * and finish with isInvoiceToPay.
 */
export const INVOICE_TO_PAY = {
  status: { in: ["SENT", "PARTIALLY_PAID"] },
  paymentClaimedAt: null,
  creditNoteForId: null,
} satisfies Prisma.InvoiceWhereInput;

export function isInvoiceToPay(invoice: {
  status: string;
  /** Left out when the caller didn't load it; the status then decides. */
  paymentClaimedAt?: string | Date | null;
  creditNoteForId?: string | null;
  amount?: number | null;
  amountPaid?: number | null;
  /** What its issued credit notes take off it (creditedTotal); none when left out. */
  credited?: number | null;
}): boolean {
  if (invoice.status !== "SENT" && invoice.status !== "PARTIALLY_PAID") return false;
  if (invoice.paymentClaimedAt || invoice.creditNoteForId) return false;
  if (invoice.amount != null && invoice.amountPaid != null) {
    return invoice.amount - invoice.amountPaid - (invoice.credited ?? 0) > 0.005;
  }
  return true;
}

/**
 * What a credit note takes off its invoice, for the balance the client sees.
 * Every portal read of an invoice's balance selects it, so they all agree.
 */
export const creditNotesShown = {
  where: { status: { notIn: ["DRAFT", "CANCELLED"] } },
  select: { amount: true, status: true },
} satisfies Prisma.Invoice$creditNotesArgs;

type Amount = number | { toString(): string };

/** A work item as the "needs you" count reads it, straight from the database. */
export type WaitingItemRow = Itemish & {
  clientApprovedAt: string | Date | null;
  clientRating: number | null;
  /** The team's open questions on it (TEAM_QUESTION's comments, counted). */
  _count: { comments: number };
};

/** An invoice as the "needs you" count reads it, straight from the database. */
export type InvoiceToPayRow = {
  status: string;
  paymentClaimedAt?: string | Date | null;
  creditNoteForId?: string | null;
  amount: Amount;
  amountPaid: Amount;
  creditNotes: { amount: Amount; status: InvoiceStatus }[];
};

/**
 * Work items waiting on the client. Each reason counts on its own, so an item
 * in review that also carries a team question counts twice, as the Action
 * Centre lists it twice.
 */
export function countWaitingItems(items: WaitingItemRow[]): number {
  const waiting = clientWaiting(items.map((m) => ({ ...m, openHelp: { team: m._count.comments } })));
  return waiting.review + waiting.questions + waiting.rating;
}

/** Invoices with a balance left after payments and credit notes, not yet reported paid. */
export function countInvoicesToPay(invoices: InvoiceToPayRow[]): number {
  return invoices.filter((i) =>
    isInvoiceToPay({
      status: i.status,
      paymentClaimedAt: i.paymentClaimedAt,
      creditNoteForId: i.creditNoteForId,
      amount: Number(i.amount),
      amountPaid: Number(i.amountPaid),
      credited: creditedTotal(i.creditNotes),
    }),
  ).length;
}

/**
 * The client's "needs you" badge from one read of their row: work waiting
 * on them, files they haven't reviewed, and invoices to pay.
 */
export function countWaiting(row: {
  projects: { milestones: WaitingItemRow[]; _count: { deliverables: number } }[];
  invoices: InvoiceToPayRow[];
}): number {
  return (
    countWaitingItems(row.projects.flatMap((p) => p.milestones)) +
    row.projects.reduce((n, p) => n + p._count.deliverables, 0) +
    countInvoicesToPay(row.invoices)
  );
}
