/**
 * One place that decides what an invoice adds up to. Used by the form (live
 * preview), the server action (what gets stored) and the PDF, so the three can
 * never disagree — previously "amount" was just Σ qty×rate with nowhere for a
 * discount or a tax line to live.
 */

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

/** What's still owed after recorded payments. */
export function balanceDue(total: number, amountPaid: number): number {
  return round(Math.max(total - amountPaid, 0));
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
