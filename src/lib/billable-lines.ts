/**
 * Which work a project has done that no invoice bills yet, as invoice lines.
 *
 * "Bill work" used to list every completed fixed-price milestone and all the
 * hours on hourly ones every time, so pressing it twice billed the same work
 * twice, and "unbilled" was the work's value minus every invoice's face
 * amount, other currencies and unrelated invoices included. Work is now
 * linked to the line that bills it (InvoiceItem.milestoneId for fixed work,
 * TimeEntry.invoiceItemId for hours), and anything linked to a line on an
 * invoice that isn't cancelled is billed. Cancelling the invoice frees the
 * work again, with no clean-up, because only the invoice's status is read.
 *
 * Archived work is never billed. Rates are in dollars, so every figure here
 * is USD. Dependency-free so the DAL, the action and the tests agree.
 */

export type BillableSource = "milestone-fixed" | "milestone-hourly" | "contract";

export type BillableLine = {
  /** Stable for the checklist: "fixed:<milestone>", "hours:<milestone>" or "contract". */
  key: string;
  description: string;
  qty: number;
  rate: number;
  /** What produced this line, so the UI can explain itself. */
  source: BillableSource;
  milestoneId: string | null;
};

export type WorkItem = {
  id: string;
  title: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  archived: boolean;
  pricingType: "NONE" | "HOURLY" | "FIXED";
  fixedPrice: number | null;
  hourlyRate: number | null;
  /** Fixed work: a line on an invoice that isn't cancelled already bills it. */
  onLiveInvoice: boolean;
};

export type WorkInput = {
  projectName: string;
  billingType: "MILESTONE" | "CONTRACT";
  contractPrice: number | null;
  /** Contract projects: USD invoiced against the project so far, net of credits. */
  contractInvoicedUsd: number;
  items: WorkItem[];
  /** Hours per item that no live invoice bills. */
  unbilledHours: Record<string, number>;
  /** Hours per item already on a live invoice; only `billed` reads them. */
  billedHours?: Record<string, number>;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * What a contract project has been invoiced so far, in USD: every invoice
 * that isn't cancelled (a draft is on its way to the client, so it counts),
 * less the credit notes issued against them. An invoice with no USD value
 * can't be counted, and is reported as missing.
 */
export function contractInvoiced(
  invoices: {
    usd: number | null;
    creditNote: boolean;
    status: string;
  }[],
): { usd: number; missing: number } {
  let usd = 0;
  let missing = 0;
  for (const invoice of invoices) {
    if (invoice.status === "CANCELLED") continue;
    if (invoice.usd == null) missing++;
    else if (!invoice.creditNote) usd += invoice.usd;
    else if (invoice.status !== "DRAFT") usd -= invoice.usd;
  }
  return { usd: round(usd), missing };
}

function hoursLabel(hours: number): string {
  return `${Number.isInteger(hours) ? hours : round(hours)}h`;
}

/**
 * The lines still to bill, what they add up to, and what is already billed
 * (all USD). A contract project bills what is left of its price.
 */
export function billableLines(work: WorkInput): {
  lines: BillableLine[];
  total: number;
  billed: number;
} {
  const lines: BillableLine[] = [];
  let billed = 0;

  if (work.billingType === "CONTRACT") {
    const price = work.contractPrice ?? 0;
    const invoiced = Math.max(work.contractInvoicedUsd, 0);
    const left = round(price - invoiced);
    billed = round(Math.min(invoiced, price));
    if (left > 0) {
      lines.push({
        key: "contract",
        description:
          invoiced > 0
            ? `${work.projectName} — rest of the fixed contract`
            : `${work.projectName} — fixed contract`,
        qty: 1,
        rate: left,
        source: "contract",
        milestoneId: null,
      });
    }
  } else {
    for (const item of work.items) {
      if (item.archived) continue;
      if (item.pricingType === "FIXED" && item.status === "COMPLETED") {
        const price = item.fixedPrice ?? 0;
        if (item.onLiveInvoice) billed += price;
        else if (price > 0) {
          lines.push({
            key: `fixed:${item.id}`,
            description: item.title,
            qty: 1,
            rate: price,
            source: "milestone-fixed",
            milestoneId: item.id,
          });
        }
      }
      if (item.pricingType === "HOURLY") {
        const rate = item.hourlyRate ?? 0;
        billed += (work.billedHours?.[item.id] ?? 0) * rate;
        const hours = round(work.unbilledHours[item.id] ?? 0);
        if (hours > 0 && rate > 0) {
          lines.push({
            key: `hours:${item.id}`,
            description: `${item.title} — ${hoursLabel(hours)}`,
            qty: hours,
            rate,
            source: "milestone-hourly",
            milestoneId: item.id,
          });
        }
      }
    }
  }

  return {
    lines,
    total: round(lines.reduce((sum, line) => sum + line.qty * line.rate, 0)),
    billed: round(billed),
  };
}
