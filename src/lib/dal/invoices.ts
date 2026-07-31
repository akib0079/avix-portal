import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";

export async function listInvoices() {
  await requireAdmin();
  return prisma.invoice.findMany({
    orderBy: { createdAt: "desc" },
    // Bounded: the list filters client-side; older invoices live on the client hub.
    take: 300,
    include: {
      client: { select: { id: true, firstName: true, lastName: true, company: true } },
      project: { select: { id: true, projectName: true } },
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
      creditNotes: { select: { id: true, invoiceNumber: true, amount: true } },
      creditNoteFor: { select: { id: true, invoiceNumber: true } },
    },
  });
}
