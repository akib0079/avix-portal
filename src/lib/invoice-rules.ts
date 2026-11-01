/**
 * Which moves an invoice allows at each point in its life. The row menu, the
 * detail page and the server actions all ask these, so a menu never offers
 * what the server will refuse. The server still enforces every one of them;
 * the UI only stops offering them.
 *
 * Dependency-free so client components and the tests can share it.
 */
import type { InvoiceStatus } from "@prisma/client";

type Kind = { status: InvoiceStatus; creditNoteForId?: string | null };

/** Why an invoice can't take a payment, or null when it can. */
export function paymentBlocker(invoice: Kind): string | null {
  if (invoice.creditNoteForId) return "A credit note doesn't take payments.";
  if (invoice.status === "CANCELLED") return "This invoice is cancelled, so it can't take payments.";
  if (invoice.status === "DRAFT") {
    return "This invoice is still a draft. Send it before recording money against it.";
  }
  return null;
}

/** Why an invoice can't be emailed to the client, or null when it can. */
export function sendBlocker(invoice: Kind): string | null {
  if (invoice.creditNoteForId) {
    return "Credit notes aren't emailed. The client sees this one in their portal.";
  }
  if (invoice.status === "CANCELLED") return "This invoice is cancelled, so it can't be sent.";
  return null;
}

/**
 * Deleting is only for an invoice nobody has been sent and no money has
 * touched: a draft or an unsent one with no payments and no credit notes.
 * Anything else is cancelled instead, so its number and history stay on the
 * record (a hard delete also took its payments and tasks with it).
 */
export function canDeleteInvoice(invoice: {
  status: InvoiceStatus;
  sentAt: Date | string | null;
  amountPaid: number;
  paymentCount: number;
  creditNoteCount: number;
}): boolean {
  return (
    (invoice.status === "DRAFT" || invoice.status === "ASSIGNED") &&
    !invoice.sentAt &&
    invoice.amountPaid <= 0 &&
    invoice.paymentCount === 0 &&
    invoice.creditNoteCount === 0
  );
}

/**
 * A draft is hidden from the client, so an invoice can only become one again
 * before the client has had it: not once it was emailed or money came in.
 */
export function draftBlocker(invoice: {
  sentAt: Date | string | null;
  amountPaid: number;
}): string | null {
  if (invoice.sentAt) {
    return "This invoice has been sent, so it can't go back to being a draft. Cancel it instead.";
  }
  if (invoice.amountPaid > 0) {
    return "This invoice has payments recorded, so it can't go back to being a draft.";
  }
  return null;
}

/**
 * Money the client still owes us: issued, not settled or void, and not a
 * credit note (which is money we owe them). Drafts aren't receivables.
 */
export function isReceivable(invoice: Kind): boolean {
  return (
    !invoice.creditNoteForId &&
    invoice.status !== "DRAFT" &&
    invoice.status !== "CANCELLED" &&
    invoice.status !== "PAID"
  );
}
