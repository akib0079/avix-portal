import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";

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
      _count: { select: { payments: true } },
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
    },
  });
}
