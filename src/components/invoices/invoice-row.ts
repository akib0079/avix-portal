import type { InvoiceStatus } from "@prisma/client";
import { balanceDue } from "@/lib/invoice-totals";
import type { PaymentTarget } from "@/components/invoices/record-payment-dialog";

/** One invoice as the list, the board and their row menus see it. */
export type InvoiceListRow = {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientId: string;
  projectName: string | null;
  issueDate: string;
  dueDate: string | null;
  amount: number;
  amountPaid: number;
  /** Taken off by this invoice's credit notes. */
  credited: number;
  /** The invoice's own currency; `amount` and `amountPaid` are in it. */
  currency: string;
  /** USD value of `amount`, null until set for a non-USD invoice. */
  amountUsd: number | null;
  status: InvoiceStatus;
  /** Set when this row is itself a credit note. */
  creditNoteForId: string | null;
  hasDocument: boolean;
  /** The supplied document is an external link rather than an upload. */
  suppliedLink: boolean;
  paymentClaimed: boolean;
  /** Emailed to the client at least once. */
  sent: boolean;
  /** Untouched and unsent, so it can be deleted rather than cancelled. */
  deletable: boolean;
};

/** What's still owed: payments and credit notes off the total, never below zero. */
export function rowBalance(row: InvoiceListRow): number {
  return balanceDue(row.amount, row.amountPaid, row.credited);
}

export function toPaymentTarget(row: InvoiceListRow): PaymentTarget {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    currency: row.currency,
    status: row.status,
    creditNoteForId: row.creditNoteForId,
    balance: rowBalance(row),
  };
}
