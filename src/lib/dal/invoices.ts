import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import type { InvoiceCopySource } from "@/lib/invoice-copy";
import type { InvoiceProjectOption } from "@/components/invoices/invoice-form";

export async function listInvoices() {
  await requireAdmin();
  return prisma.invoice.findMany({
    orderBy: { createdAt: "desc" },
    // Bounded: the list filters client-side; older invoices live on the client hub.
    take: 300,
    // Only what the list and its row menu show: no notes, bill-to or lines.
    select: {
      id: true,
      invoiceNumber: true,
      issueDate: true,
      dueDate: true,
      amount: true,
      amountPaid: true,
      amountUsd: true,
      currency: true,
      status: true,
      pdfPath: true,
      pdfExternalUrl: true,
      paymentClaimedAt: true,
      sentAt: true,
      creditNoteForId: true,
      client: { select: { id: true, firstName: true, lastName: true, company: true } },
      project: { select: { id: true, projectName: true } },
      // Credit notes come off the balance; the counts decide delete vs cancel.
      creditNotes: { select: { amount: true, status: true } },
      // The repeat mark and the Recurring filter.
      retainer: { select: { title: true } },
      _count: { select: { payments: true, retainerTemplateFor: true } },
    },
  });
}

export async function getInvoice(id: string) {
  await requireAdmin();
  return prisma.invoice.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, email: true, company: true } },
      project: { select: { id: true, projectName: true } },
      items: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { paidAt: "desc" } },
      creditNotes: { select: { id: true, invoiceNumber: true, amount: true, status: true } },
      creditNoteFor: { select: { id: true, invoiceNumber: true } },
      duplicatedFrom: { select: { id: true, invoiceNumber: true } },
      // The Repeat card: the plan this invoice is part of, and the plans
      // that copy it.
      retainer: {
        select: {
          id: true,
          title: true,
          active: true,
          frequency: true,
          interval: true,
          dayOfMonth: true,
          nextRunAt: true,
          endAfterCount: true,
          endDate: true,
          runCount: true,
          autoSend: true,
          lastGeneratedPeriod: true,
          lastRunError: true,
          templateInvoice: {
            select: { id: true, title: true, issueDate: true, retainerId: true, retainerPeriod: true },
          },
        },
      },
      retainerTemplateFor: { select: { id: true, title: true } },
    },
  });
}

/**
 * What invoiceCopyDefaults reads from an invoice, as one statement: the project
 * and payment account come with what decides whether they carry over.
 * Exported with toInvoiceCopySource for the duties engine, which copies a
 * plan's template without a session and so can't use getInvoiceCopySource.
 */
export const invoiceCopySourceSelect = {
  id: true,
  invoiceNumber: true,
  clientId: true,
  title: true,
  currency: true,
  amount: true,
  subtotal: true,
  amountUsd: true,
  discount: true,
  taxRate: true,
  taxLabel: true,
  paymentTermsDays: true,
  issueDate: true,
  dueDate: true,
  notes: true,
  billToCompany: true,
  billToAddress: true,
  billToEmail: true,
  creditNoteForId: true,
  project: { select: { id: true, clientId: true } },
  paymentAccount: { select: { id: true, isActive: true } },
  items: {
    orderBy: { sortOrder: "asc" },
    select: { description: true, descriptionRich: true, qty: true, rate: true },
  },
} satisfies Prisma.InvoiceSelect;

/** The selected row with Decimals as plain numbers, as invoiceCopyDefaults wants. */
export function toInvoiceCopySource(
  row: Prisma.InvoiceGetPayload<{ select: typeof invoiceCopySourceSelect }>,
): InvoiceCopySource {
  return {
    ...row,
    amount: Number(row.amount),
    subtotal: row.subtotal == null ? null : Number(row.subtotal),
    amountUsd: row.amountUsd == null ? null : Number(row.amountUsd),
    discount: Number(row.discount),
    taxRate: row.taxRate == null ? null : Number(row.taxRate),
    items: row.items.map((item) => ({
      description: item.description,
      descriptionRich: item.descriptionRich,
      qty: Number(item.qty),
      rate: Number(item.rate),
    })),
  };
}

/** The invoice "Duplicate" copies, for the new-invoice page. */
export async function getInvoiceCopySource(id: string): Promise<InvoiceCopySource | null> {
  await requireAdmin();
  const row = await prisma.invoice.findUnique({ where: { id }, select: invoiceCopySourceSelect });
  return row ? toInvoiceCopySource(row) : null;
}

/**
 * Projects an invoice for one client can link to: that client's own, and any
 * with no client. Loaded for the client being invoiced rather than every
 * project in the system; `ofInvoice` finds that client through the invoice,
 * so a page can run this beside the invoice read instead of after it.
 */
export async function listInvoiceProjectOptions(
  by: { clientId: string } | { ofInvoice: string },
): Promise<InvoiceProjectOption[]> {
  await requireAdmin();
  const owner =
    "clientId" in by
      ? { clientId: by.clientId }
      : { client: { invoices: { some: { id: by.ofInvoice } } } };
  return prisma.project.findMany({
    where: { OR: [owner, { clientId: null }] },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, projectName: true, clientId: true },
  });
}
