import type { InvoiceStatus } from "@prisma/client";
import type { WorkBilling } from "@/lib/board";

/**
 * The per-item numbers that come from other tables: open help requests by the
 * side that asked, logged hours, and (ADMIN only) the invoices billing it.
 * The reads select them on each item row (dal/project-board.ts), so the rows
 * and their numbers are one statement; this folds them into lookups. Pure and
 * dependency-free (types only), so it's tested once (work-extras.test.ts).
 */
export type ItemExtras = {
  help: Map<string, { client: number; team: number }>;
  hours: Map<string, number>;
  billing: Map<string, WorkBilling[]>;
};

/** An item row with its other-table relations selected. */
export type ExtrasRow = {
  id: string;
  /** Unanswered help requests (kind HELP, unresolved). */
  comments: { authorRole: string }[];
  /** Prisma.Decimal(6, 2) in the database. */
  timeEntries: { hours: unknown }[];
  /** Lines on invoices that aren't cancelled. Only ADMIN reads select them. */
  invoiceItems?: { invoice: { id: string; invoiceNumber: string; status: InvoiceStatus } }[];
};

export function extrasFromRows(rows: readonly ExtrasRow[]): ItemExtras {
  const extras: ItemExtras = { help: new Map(), hours: new Map(), billing: new Map() };
  for (const row of rows) {
    if (row.comments.length > 0) {
      const client = row.comments.filter((c) => c.authorRole === "CLIENT").length;
      extras.help.set(row.id, { client, team: row.comments.length - client });
    }
    if (row.timeEntries.length > 0) {
      // Hours have two decimals: summed in hundredths, 0.1 + 0.2 stays 0.3.
      const hundredths = row.timeEntries.reduce((sum, e) => sum + Math.round(Number(e.hours) * 100), 0);
      extras.hours.set(row.id, hundredths / 100);
    }
    if (row.invoiceItems && row.invoiceItems.length > 0) {
      // Two lines on one invoice are one billing.
      const list: WorkBilling[] = [];
      for (const { invoice } of row.invoiceItems) {
        if (list.some((b) => b.invoiceId === invoice.id)) continue;
        list.push({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, status: invoice.status });
      }
      extras.billing.set(row.id, list);
    }
  }
  return extras;
}
