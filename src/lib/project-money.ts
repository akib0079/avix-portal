/**
 * The project Money tab's invoice totals, in USD. Credit notes are money
 * back, never invoiced or owed: each one comes off the invoice it credits,
 * floored at zero there, so a refund credit on a paid invoice owes nothing
 * rather than taking the totals negative. Every row counts at its USD value,
 * scaled from its own currency; one with no USD value is left out and
 * counted, as the dashboard does.
 *
 * Dependency-free so the page and the tests agree.
 */
import { balanceDue } from "./invoice-totals";
import { usdValue } from "./invoice-usd";

export type ProjectInvoice = {
  amount: number;
  amountPaid: number;
  status: string;
  currency: string;
  amountUsd: number | null;
  creditNoteForId: string | null;
  /** What its live credit notes take off it (creditedTotal). */
  credited: number;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function projectMoneyTotals(invoices: ProjectInvoice[]): {
  invoiced: number;
  paid: number;
  outstanding: number;
  /** Invoices that count: not cancelled, not credit notes. */
  count: number;
  /** Of those, how many have no USD value and are left out. */
  missingUsd: number;
} {
  let invoiced = 0;
  let paid = 0;
  let outstanding = 0;
  let count = 0;
  let missingUsd = 0;
  for (const invoice of invoices) {
    if (invoice.status === "CANCELLED" || invoice.creditNoteForId) continue;
    count++;
    const usd = usdValue(invoice);
    if (usd == null) {
      missingUsd++;
      continue;
    }
    if (invoice.amount <= 0) continue;
    const rate = usd / invoice.amount;
    invoiced += Math.max(invoice.amount - invoice.credited, 0) * rate;
    paid += Math.min(invoice.amountPaid, invoice.amount) * rate;
    // Nothing on a draft is owed until it has been sent.
    if (invoice.status !== "DRAFT") {
      outstanding += balanceDue(invoice.amount, invoice.amountPaid, invoice.credited) * rate;
    }
  }
  return {
    invoiced: round(invoiced),
    paid: round(paid),
    outstanding: round(outstanding),
    count,
    missingUsd,
  };
}
