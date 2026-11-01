/**
 * One place that decides what an invoice adds up to. Used by the form (live
 * preview), the server action (what gets stored) and the PDF, so the three can
 * never disagree — previously "amount" was just Σ qty×rate with nowhere for a
 * discount or a tax line to live.
 */

import type { InvoiceStatus } from "@prisma/client";

export type InvoiceTotalsInput = {
  items?: { qty: number; rate: number }[];
  /** Used when there are no line items. */
  amount?: number;
  discount?: number | null;
  taxRate?: number | null;
};

export type InvoiceTotals = {
  subtotal: number;
  discount: number;
  taxable: number;
  taxAmount: number;
  total: number;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function invoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const subtotal = input.items?.length
    ? round(input.items.reduce((sum, i) => sum + i.qty * i.rate, 0))
    : round(input.amount ?? 0);

  // A discount can never exceed the subtotal — a negative invoice is a credit
  // note, which is a different document.
  const discount = Math.min(round(Math.max(input.discount ?? 0, 0)), subtotal);
  const taxable = round(subtotal - discount);
  const taxAmount = input.taxRate ? round((taxable * input.taxRate) / 100) : 0;

  return {
    subtotal,
    discount,
    taxable,
    taxAmount,
    total: round(taxable + taxAmount),
  };
}

/** What's still owed after recorded payments and any credit notes. */
export function balanceDue(total: number, amountPaid: number, credited = 0): number {
  return round(Math.max(total - amountPaid - credited, 0));
}

/**
 * How much an invoice's credit notes take off it. A cancelled credit note
 * credits nothing, and neither does one still being drafted.
 */
export function creditedTotal(
  creditNotes: { amount: number | { toString(): string }; status: InvoiceStatus }[],
): number {
  return round(
    creditNotes
      .filter((note) => note.status !== "CANCELLED" && note.status !== "DRAFT")
      .reduce((sum, note) => sum + Number(note.amount), 0),
  );
}

/**
 * Where an invoice's status should stand once its money is known.
 *
 * PAID when payments and credit notes together cover the total, PARTIALLY_PAID
 * when some money has come in, and otherwise whatever it already was. That last
 * part is the point: the old payment code set SENT whenever nothing was left
 * paid, which turned a draft, an invoice under review or a cancelled one into
 * "Sent" just because a payment row was removed.
 *
 * Money never moves CANCELLED (void) or DRAFT (not issued yet); neither takes
 * payments. A credit alone doesn't make an invoice part-paid, since no money
 * has come in, but it counts toward settling: one credited in full is PAID.
 * A status that claims money the invoice no longer has, such as PAID after its
 * payment is removed, steps back to `fallback` (see unsettledStatus).
 */
export function settleStatus(input: {
  total: number;
  paid: number;
  credited?: number;
  current: InvoiceStatus;
  fallback?: InvoiceStatus;
}): InvoiceStatus {
  const { current } = input;
  if (current === "CANCELLED" || current === "DRAFT") return current;
  const paid = round(input.paid);
  const covered = round(paid + (input.credited ?? 0));
  if (covered > 0 && covered >= round(input.total)) return "PAID";
  if (paid > 0) return "PARTIALLY_PAID";
  if (current === "PAID" || current === "PARTIALLY_PAID") return input.fallback ?? "SENT";
  return current;
}

/**
 * Where an issued invoice stands with no money on it: the client says they
 * have paid, it was emailed, or it was issued without being emailed.
 */
export function unsettledStatus(invoice: {
  sentAt: Date | string | null;
  paymentClaimedAt: Date | string | null;
}): InvoiceStatus {
  if (invoice.paymentClaimedAt) return "IN_REVIEW";
  return invoice.sentAt ? "SENT" : "ASSIGNED";
}

/**
 * Due date implied by net terms, or null when no terms are set.
 *
 * All arithmetic is in UTC. Doing it in local time and then calling
 * toISOString() shifts the result back a day for anyone east of UTC — in
 * Dhaka (UTC+6), Net 14 from 31 Jul produced 13 Aug instead of 14 Aug, so
 * every invoice fell due a day early.
 */
export function dueDateFromTerms(issueDate: string, termsDays: number | null | undefined): string | null {
  if (termsDays == null) return null;
  const issued = new Date(`${issueDate}T00:00:00Z`);
  if (Number.isNaN(issued.getTime())) return null;
  issued.setUTCDate(issued.getUTCDate() + termsDays);
  return issued.toISOString().slice(0, 10);
}
