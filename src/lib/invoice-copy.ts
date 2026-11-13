/**
 * A new invoice made from an old one: what "Duplicate" fills the form with,
 * and what a recurring plan copies for each new period.
 *
 * The owner's complaint was that every invoice started from scratch, so this
 * copies everything that describes the work and the terms, and resets
 * everything that belongs to one particular invoice:
 *
 *  - Copied: client, project (only while it is still that client's), title,
 *    currency, every line (with its formatting), discount, tax, payment
 *    terms, notes, the bill-to overrides, and the payment account if it is
 *    still in use.
 *  - Reset: the number (the next one is assigned on save), the status (a
 *    DRAFT, which the client can't see), the issue date (today), the due date
 *    (from the terms, or the same gap as last time), payments and every
 *    sent/claimed/reminder stamp.
 *  - Never copied: an uploaded or linked PDF. A file belongs to one invoice,
 *    and deleting or replacing it on one would remove it from the other.
 *    Nor the pay link: a hosted payment page is usually for one amount.
 *
 * A credit note is refused: it is issued against an invoice, never copied.
 *
 * Pure and dependency-light so the new-invoice page, the recurring duty and
 * the tests share it.
 */
import type { InvoiceInput } from "@/lib/validation/invoice";
import { dueDateFromTerms, invoiceTotals } from "@/lib/invoice-totals";

export type InvoiceCopySource = {
  id: string;
  invoiceNumber: string;
  clientId: string;
  /** The project with the client it belongs to now. */
  project: { id: string; clientId: string | null } | null;
  title: string | null;
  currency: NonNullable<InvoiceInput["currency"]>;
  amount: number;
  subtotal: number | null;
  amountUsd: number | null;
  discount: number;
  taxRate: number | null;
  taxLabel: string | null;
  paymentTermsDays: number | null;
  issueDate: Date;
  dueDate: Date | null;
  notes: string | null;
  billToCompany: string | null;
  billToAddress: string | null;
  billToEmail: string | null;
  paymentAccount: { id: string; isActive: boolean } | null;
  creditNoteForId: string | null;
  items: { description: string; descriptionRich: unknown; qty: number; rate: number }[];
};

export type InvoiceCopy =
  | {
      ok: true;
      input: InvoiceInput;
      /**
       * What the source was worth in USD when it is billed in another
       * currency. Shown as "last time $X" beside the USD field: the value is
       * entered by hand at the rate it settles at, so it is never copied.
       */
      lastAmountUsd: number | null;
    }
  | { ok: false; error: string };

const DAY_MS = 86_400_000;

/** YYYY-MM-DD plus whole days, in UTC so no timezone can shift it. */
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Today's date in a timezone, as YYYY-MM-DD (what a date input holds). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // An unknown zone in settings must not break invoicing.
    return now.toISOString().slice(0, 10);
  }
}

/** JSON in, an independent copy out, so editing the copy never touches the source. */
function cloneJson<T>(value: T): T {
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export function invoiceCopyDefaults(
  source: InvoiceCopySource,
  { today }: { today: string },
): InvoiceCopy {
  if (source.creditNoteForId) {
    return {
      ok: false,
      error: "A credit note can't be duplicated. Issue a new one from the invoice it credits.",
    };
  }

  // An invoice from before line items printed one line: its notes (or
  // "Services rendered") for the amount before discount and tax. The copy
  // gets that line for real, so it can be saved and printed as it was.
  const legacy = source.items.length === 0;
  const items = legacy
    ? [
        {
          description: source.notes?.trim() || "Services rendered",
          descriptionRich: null,
          qty: 1,
          rate: source.subtotal ?? source.amount,
        },
      ]
    : source.items.map((item) => ({
        description: item.description,
        descriptionRich: cloneJson(item.descriptionRich) ?? null,
        qty: item.qty,
        rate: item.rate,
      }));

  // From the terms when there are any; otherwise the same gap between issue
  // and due date as last time; otherwise no due date.
  const gapDays = source.dueDate
    ? Math.max(0, Math.round((source.dueDate.getTime() - source.issueDate.getTime()) / DAY_MS))
    : null;
  const dueDate =
    dueDateFromTerms(today, source.paymentTermsDays) ??
    (gapDays == null ? "" : addDays(today, gapDays));

  const total = invoiceTotals({
    items,
    discount: source.discount,
    taxRate: source.taxRate,
  }).total;

  return {
    ok: true,
    input: {
      clientId: source.clientId,
      projectId:
        source.project && source.project.clientId === source.clientId ? source.project.id : "none",
      invoiceNumber: "",
      title: source.title ?? "",
      currency: source.currency,
      items,
      amount: total,
      // Never carried: a dollar copy is worth its own total once saved
      // (usdToStore), and seeded here it stayed as the USD value of a copy
      // switched to another currency. Any other currency waits for the value
      // it settles at.
      amountUsd: null,
      discount: source.discount,
      taxRate: source.taxRate,
      taxLabel: source.taxLabel ?? "",
      paymentTermsDays: source.paymentTermsDays,
      status: "DRAFT",
      issueDate: today,
      dueDate,
      // The legacy line already carries what the notes said.
      notes: legacy ? "" : (source.notes ?? ""),
      billToCompany: source.billToCompany ?? "",
      billToAddress: source.billToAddress ?? "",
      billToEmail: source.billToEmail ?? "",
      paymentAccountId: source.paymentAccount?.isActive ? source.paymentAccount.id : "none",
      payLinkUrl: "",
      pdfExternalUrl: "",
      duplicatedFromId: source.id,
    },
    lastAmountUsd: source.currency === "USD" ? null : source.amountUsd,
  };
}
