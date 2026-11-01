import type { InvoiceStatus, ProposalStatus } from "@prisma/client";
import { formatCurrency, sumByCurrency } from "./currency";

/**
 * The decisions behind the proposal flow that don't need a database: what
 * "Delete" does, when the draft invoice may go with it, what the client is
 * promised as a first invoice, when a reminder is due, and how money adds up
 * across currencies. Dependency-free, so the server, the board and the tests
 * all read the same rules.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type DateLike = Date | string | null | undefined;

function ms(value: DateLike): number | null {
  if (value == null) return null;
  const t = typeof value === "string" ? Date.parse(value) : value.getTime();
  return Number.isNaN(t) ? null : t;
}

// ---------- Delete or archive ----------

/**
 * "Delete" on a proposal. One that never left the building is removed
 * outright: nobody outside has seen it, so nothing is lost. Anything a client
 * may have opened is archived instead (hidden from the board, its link
 * withdrawn), because a sent, declined or accepted proposal is part of the
 * record of what was offered and agreed.
 */
export function proposalRemovalMode(p: {
  status: ProposalStatus;
  sentAt: DateLike;
}): "delete" | "archive" {
  return p.status === "DRAFT" && ms(p.sentAt) == null ? "delete" : "archive";
}

/** What the server knows about the invoice created alongside a proposal. */
export type DraftInvoiceFacts = {
  status: InvoiceStatus;
  sentAt: DateLike;
  amountPaid: number;
  paymentCount: number;
};

/**
 * The proposal's invoice may only be removed while it is still paperwork:
 * never sent, nothing paid, no payment rows. Once it has reached the client or
 * money has moved against it, it is a business record with its own delete
 * flow. deleteProposal repeats this as a conditional delete inside its
 * transaction, so a send or payment that lands meanwhile still wins.
 */
export function draftInvoiceRemovable(invoice: DraftInvoiceFacts | null): boolean {
  if (!invoice) return false;
  return (
    (invoice.status === "DRAFT" || invoice.status === "ASSIGNED") &&
    ms(invoice.sentAt) == null &&
    invoice.amountPaid === 0 &&
    invoice.paymentCount === 0
  );
}

export type ProposalRemovalPlan = {
  mode: "delete" | "archive";
  /**
   * remove: deleted along with the proposal (unsent drafts, when safe).
   * offer: archive may remove it too, if the admin ticks the box.
   * keep: it stays, whatever happens to the proposal.
   * none: there is no invoice to speak of.
   */
  invoice: "remove" | "offer" | "keep" | "none";
};

/**
 * The whole decision, shared by the confirm dialog (what it says and offers)
 * and the server (what it does). An accepted proposal never takes its invoice
 * with it: that invoice is the client's, attached to a live project.
 */
export function proposalRemovalPlan(
  proposal: { status: ProposalStatus; sentAt: DateLike },
  invoice: DraftInvoiceFacts | null,
): ProposalRemovalPlan {
  const mode = proposalRemovalMode(proposal);
  if (!invoice) return { mode, invoice: "none" };
  const removable = draftInvoiceRemovable(invoice);
  if (mode === "delete") return { mode, invoice: removable ? "remove" : "keep" };
  if (proposal.status === "ACCEPTED") return { mode, invoice: "keep" };
  return { mode, invoice: removable ? "offer" : "keep" };
}

// ---------- Money ----------

/** The deposit percentage of a total, to the cent. */
export function depositAmount(total: number, depositPercent: number): number {
  return Math.round(total * depositPercent) / 100;
}

export type FirstInvoicePromise =
  | { kind: "invoice"; amount: number; currency: string }
  | { kind: "deposit"; percent: number; amount: number; currency: string }
  | null;

/**
 * What the client is told they will be invoiced first.
 *
 * The proposal used to promise "the 50% deposit" while acceptance attached
 * whatever invoice step 2 of the builder held, often the full scope and
 * sometimes in another currency. Now the promise is the invoice itself when
 * one is attached, and the deposit only when acceptance will create that
 * deposit, so what we say and what we send can't disagree. The hand-off makes
 * the same call (see runHandoff).
 */
export function firstInvoicePromise(
  proposal: { total: number; currency: string; depositPercent: number },
  invoice: { amount: number; currency: string; status: InvoiceStatus } | null,
): FirstInvoicePromise {
  if (invoice && invoice.status !== "CANCELLED") {
    return { kind: "invoice", amount: invoice.amount, currency: invoice.currency };
  }
  const amount = depositAmount(proposal.total, proposal.depositPercent);
  if (amount <= 0) return null;
  return { kind: "deposit", percent: proposal.depositPercent, amount, currency: proposal.currency };
}

/**
 * Proposal totals per currency, largest first, zero totals dropped. A lane of
 * GBP and USD proposals has two totals: adding them gives a number that is
 * true of nothing.
 */
export function totalsByCurrency(
  rows: { total: number; currency: string }[],
): { code: string; total: number }[] {
  return sumByCurrency(rows.map((r) => ({ amount: r.total, currency: r.currency }))).filter(
    (t) => t.total > 0,
  );
}

/** "£1,500.00 + $3,000.00"; empty when there is nothing to show. */
export function formatTotals(totals: { code: string; total: number }[]): string {
  return totals.map((t) => formatCurrency(t.total, t.code)).join(" + ");
}

// ---------- Reminders ----------

/** Polite "still interested?" emails go out this many days before expiry. */
export const PROPOSAL_REMINDER_DAYS = [3, 1] as const;

/**
 * Whether a reminder is due now, and which one.
 *
 * A reminder belongs to a window that opens N days before expiry. It is due
 * once the window has opened, if the proposal was sent before it opened (a
 * proposal sent with two days to run doesn't need a "3 days left" email the
 * moment it lands) and nothing has been sent since the window opened. The
 * closest window is checked first, so a run that comes late sends one email,
 * not two.
 */
export function dueProposalReminder(
  proposal: { expiresAt: DateLike; sentAt: DateLike; lastReminderAt: DateLike },
  now: Date,
): { daysBefore: number } | null {
  const expires = ms(proposal.expiresAt);
  const sent = ms(proposal.sentAt);
  if (expires == null || sent == null) return null;
  const nowMs = now.getTime();
  if (nowMs >= expires) return null;
  const last = ms(proposal.lastReminderAt);

  for (const daysBefore of [...PROPOSAL_REMINDER_DAYS].sort((a, b) => a - b)) {
    const opens = expires - daysBefore * DAY_MS;
    if (nowMs < opens) continue;
    if (sent >= opens) continue;
    if (last != null && last >= opens) continue;
    return { daysBefore };
  }
  return null;
}

/** "tomorrow", "in 3 days" — for a deadline that hasn't passed. */
export function timeLeftText(expiresAt: DateLike, now: Date): string {
  const expires = ms(expiresAt) ?? now.getTime();
  const days = Math.max(1, Math.ceil((expires - now.getTime()) / DAY_MS));
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

// ---------- Views ----------

/** "just now", "5m ago", "2h ago", "3d ago", "2mo ago". */
export function timeAgo(value: DateLike, nowMs: number): string {
  const t = ms(value);
  if (t == null) return "";
  const seconds = Math.max(0, (nowMs - t) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86_400);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** "Opened 3x, last 2h ago" — null until the client has opened it. */
export function viewSummary(
  viewCount: number,
  lastViewedAt: DateLike,
  nowMs: number,
): string | null {
  if (viewCount < 1 || ms(lastViewedAt) == null) return null;
  const ago = timeAgo(lastViewedAt, nowMs);
  if (viewCount === 1) return `Opened once, ${ago}`;
  return ago === "just now" ? `Opened ${viewCount}x, just now` : `Opened ${viewCount}x, last ${ago}`;
}
