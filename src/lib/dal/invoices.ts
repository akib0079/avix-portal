import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";

export async function listInvoices() {
  await requireAdmin();
  return prisma.invoice.findMany({
    orderBy: { createdAt: "desc" },
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
    },
  });
}
