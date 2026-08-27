/**
 * Turning an invoice into the one number the business runs on: USD.
 *
 * An invoice carries two amounts that must never be confused. `amount` is what
 * the client owes, in the currency on the document — that is what the portal
 * and the PDF show, and adding it across currencies is meaningless. `amountUsd`
 * is what the money is worth once it lands, and it is the only figure a total,
 * an average or a target may use.
 *
 * Dependency-free so the DAL, the reports and the form can all share it.
 */

export type UsdSource = {
  amount: number;
  currency: string;
  amountUsd: number | null;
};

/** True when the currency needs a hand-entered USD figure. */
export function needsUsdValue(currency: string): boolean {
  return currency !== "USD";
}

/**
 * The invoice's worth in USD, or null when nobody has said yet.
 *
 * Null rather than a guess on purpose. Falling back to `amount` is exactly the
 * bug this replaced: a EUR 1400 invoice silently counted as $1400 of revenue,
 * indistinguishable from a real one. A missing value should shrink the total
 * and announce itself, not quietly corrupt it.
 */
export function usdValue(invoice: UsdSource): number | null {
  if (invoice.amountUsd != null) return invoice.amountUsd;
  return invoice.currency === "USD" ? invoice.amount : null;
}

/**
 * How much of a part-paid invoice has landed, in USD.
 *
 * Scaled from the proportion paid in the invoice's own currency, because the
 * USD figure is recorded per invoice rather than per payment. Exact for the
 * usual cases — nothing paid, paid in full — and a fair split otherwise.
 */
export function usdPaid(invoice: UsdSource & { amountPaid: number }): number | null {
  const total = usdValue(invoice);
  if (total == null) return null;
  if (invoice.amount <= 0) return 0;
  const ratio = Math.min(1, invoice.amountPaid / invoice.amount);
  return Math.round(total * ratio * 100) / 100;
}

/** Sum in USD, plus how many rows had to be skipped for want of a value. */
export function sumUsd(invoices: UsdSource[]): { total: number; missing: number } {
  let total = 0;
  let missing = 0;
  for (const invoice of invoices) {
    const value = usdValue(invoice);
    if (value == null) missing++;
    else total += value;
  }
  return { total: Math.round(total * 100) / 100, missing };
}
