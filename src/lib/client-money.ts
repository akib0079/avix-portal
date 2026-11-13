/**
 * The money a client hub leads with: billed, collected, outstanding and
 * overdue, all in USD.
 *
 * Totalled per invoice at that invoice's own USD value, because adding
 * EUR 2,000 to $1,000 as "$3,000" is meaningless (see invoice-usd.ts). An
 * invoice with no USD value yet is left out and counted in `unconverted`,
 * so the figures shrink and say so rather than guess.
 *
 * Credit notes come off what was billed and what is owed, as balanceDue does
 * everywhere else. Outstanding is the sum of each invoice's own balance, not
 * billed − collected: an overpayment on one invoice doesn't pay another.
 * A PAID invoice owes nothing, whatever its recorded payments say.
 *
 * Dependency-free so it can be tested on its own.
 */

import { balanceDue } from "@/lib/invoice-totals";
import { usdValue } from "@/lib/invoice-usd";

export type ClientMoneyInvoice = {
  amount: number;
  amountPaid: number;
  currency: string;
  amountUsd: number | null;
  status: string;
  dueDate: Date | null;
  /** What its issued credit notes take off it (creditedTotal). */
  credited: number;
};

export type ClientMoney = {
  billed: number;
  collected: number;
  outstanding: number;
  overdue: number;
  /** Invoices with no USD value yet, so in none of the figures. */
  unconverted: number;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clientMoney(invoices: ClientMoneyInvoice[], now: Date): ClientMoney {
  let billed = 0;
  let collected = 0;
  let outstanding = 0;
  let overdue = 0;
  let unconverted = 0;
  for (const i of invoices) {
    // Nothing billed is $0 in any currency: in no figure, and not unconverted.
    if (i.amount <= 0) continue;
    const worth = usdValue(i);
    if (worth == null) {
      unconverted++;
      continue;
    }
    // From the invoice's currency to USD at its own recorded value.
    const rate = worth / i.amount;
    const credited = Math.min(i.credited, i.amount);
    const owed = i.status === "PAID" ? 0 : balanceDue(i.amount, i.amountPaid, credited);
    billed += (i.amount - credited) * rate;
    collected += Math.min(i.amountPaid, i.amount) * rate;
    outstanding += owed * rate;
    if (owed > 0 && i.dueDate && i.dueDate < now) overdue += owed * rate;
  }
  return {
    billed: round(billed),
    collected: round(collected),
    outstanding: round(outstanding),
    overdue: round(overdue),
    unconverted,
  };
}
