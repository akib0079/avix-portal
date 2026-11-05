import type { InvoiceStatus, ProposalStatus } from "@prisma/client";
import { formatCurrency, sumByCurrency } from "./currency";
import { invoiceStatusLabels } from "./format";

/**
 * The decisions behind the proposal flow that don't need a database: what
 * "Delete" does, when the draft invoice may go with it, what the client is
 * promised as a first invoice, what acceptance sets up, when a reminder is
 * due, and how money adds up across currencies. Dependency-free, so the
 * server, the board and the tests all read the same rules.
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
  /** The client reported paying it. */
  paymentClaimedAt: DateLike;
  /** Credit notes issued against it. */
  creditNoteCount: number;
  /**
   * A recurring plan with invoices of its own copies it each period. (A plan
   * this invoice alone started doesn't count: it goes with the invoice.)
   */
  copiedByPlan: boolean;
};

/**
 * The proposal's invoice may only be removed (or rewritten by the builder)
 * while it is still paperwork: never sent, nothing paid or reported paid, no
 * credit notes, and no running plan copying it. Past that it is a business
 * record with its own delete flow, the same line deleteInvoice draws.
 * removeDraftInvoice repeats this as a conditional delete inside the caller's
 * transaction, so a send or payment that lands meanwhile still wins.
 */
export function draftInvoiceRemovable(invoice: DraftInvoiceFacts | null): boolean {
  if (!invoice) return false;
  return (
    (invoice.status === "DRAFT" || invoice.status === "ASSIGNED") &&
    ms(invoice.sentAt) == null &&
    ms(invoice.paymentClaimedAt) == null &&
    invoice.amountPaid === 0 &&
    invoice.paymentCount === 0 &&
    invoice.creditNoteCount === 0 &&
    !invoice.copiedByPlan
  );
}

/** Why the invoice stays, in the words of draftInvoiceRemovable: "Invoice INV-041 stays: …". */
export function invoiceKeptReason(invoice: DraftInvoiceFacts): string {
  if (ms(invoice.sentAt) != null) return "it has already been sent";
  if (invoice.amountPaid > 0 || invoice.paymentCount > 0) return "money has been recorded against it";
  if (ms(invoice.paymentClaimedAt) != null) return "the client reported paying it";
  if (invoice.creditNoteCount > 0) return "credit notes were issued against it";
  if (invoice.copiedByPlan) return "a recurring plan copies it";
  return `it is ${invoiceStatusLabels[invoice.status].toLowerCase()}`;
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

/**
 * Deleting a lead: which of its proposals outlive it. A draft nobody was sent
 * goes with the lead, tidied up as deleting it would be. A sent, declined or
 * archived one is the record of what was offered (archived ones can still be
 * restored), so it stays as a proposal without a lead, addressed as the lead
 * was. deleteLead repeats this as its where clause.
 */
export function keptWithoutLead(p: { status: ProposalStatus; sentAt: DateLike; archivedAt: DateLike }): boolean {
  return proposalRemovalMode(p) === "archive" || ms(p.archivedAt) != null;
}

/** What the lead delete dialogs say happens to the lead's proposals. */
export function leadDeleteNote(counts: { unsent: number; kept: number }): string | null {
  const parts: string[] = [];
  if (counts.unsent > 0) {
    parts.push(
      `${counts.unsent} unsent draft proposal${counts.unsent === 1 ? " is" : "s are"} deleted with it.`,
    );
  }
  if (counts.kept > 0) {
    parts.push(
      `${counts.kept} sent or archived proposal${counts.kept === 1 ? " stays" : "s stay"}, addressed to the lead's contact.`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

// ---------- The builder ----------

/**
 * The builder edits the invoice's lines as plain text, while the invoice page
 * can also format them (descriptionRich). On a builder save, a line whose
 * words were left alone keeps its formatting, matched in order so two lines
 * with the same words keep their own; a line whose words changed drops it,
 * because the formatted version would still print the old wording.
 */
export function keepLineFormatting<Row extends { description: string }, Rich>(
  saved: { description: string; descriptionRich: Rich | null }[],
  rows: Row[],
): (Row | (Row & { descriptionRich: NonNullable<Rich> }))[] {
  const byWords = new Map<string, (Rich | null)[]>();
  for (const line of saved) {
    const queue = byWords.get(line.description);
    if (queue) queue.push(line.descriptionRich);
    else byWords.set(line.description, [line.descriptionRich]);
  }
  return rows.map((row) => {
    const rich = byWords.get(row.description)?.shift();
    return rich == null ? row : { ...row, descriptionRich: rich };
  });
}

// ---------- Money ----------

/**
 * The deposit percentage of a total, to the cent, half a cent rounding up.
 * Worked in whole cents: 1.15 × 50 is 57.4999… in floating point, which
 * rounded the deposit on £1.15 down to £0.57.
 */
export function depositAmount(total: number, depositPercent: number): number {
  return Math.round((Math.round(total * 100) * depositPercent) / 100) / 100;
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

/** A YYYY-MM-DD day as whole days since the epoch, in UTC so no zone shifts it. */
function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

/**
 * The dates the proposal's invoice is issued with once the client accepts.
 * The builder dated it when the proposal was made, often weeks earlier; kept,
 * it would land already overdue, and the chaser's final reminder would follow
 * days after it was sent. An issue date before the acceptance day moves to
 * that day and the due date follows: the invoice's net terms when it has
 * them, otherwise the gap it had (none without a due date). A later issue
 * date was chosen on purpose and stays. Null when nothing moves.
 */
export function acceptedInvoiceDates(
  invoice: { issueDate: string; dueDate: string | null; paymentTermsDays: number | null },
  today: string,
): { issueDate: string; dueDate: string | null } | null {
  if (invoice.issueDate >= today) return null;
  const days =
    invoice.paymentTermsDays ??
    (invoice.dueDate ? Math.max(0, dayNumber(invoice.dueDate) - dayNumber(invoice.issueDate)) : null);
  if (days == null) return { issueDate: today, dueDate: null };
  const due = new Date((dayNumber(today) + days) * DAY_MS).toISOString().slice(0, 10);
  return { issueDate: today, dueDate: due };
}

/**
 * What the project a signed proposal creates is priced at. Project prices
 * are dollars (Bill work, the portal and the project form all read them so)
 * and nothing here converts currencies, so an agreement in another currency
 * starts with no price: the admin enters its USD value once they know it,
 * and the proposal keeps the agreed total in its own currency.
 */
export function handoffContractPrice(proposal: { total: number; currency: string }): number | null {
  return proposal.currency === "USD" ? proposal.total : null;
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
