import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";

export async function listClients() {
  await requireAdmin();
  return prisma.user.findMany({
    where: { role: "CLIENT" },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { projects: true, invoices: true } },
    },
  });
}

export async function getClient(id: string) {
  await requireAdmin();
  return prisma.user.findFirst({
    where: { id, role: "CLIENT" },
    include: {
      projects: { orderBy: { createdAt: "desc" } },
      invoices: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function listActiveClientOptions() {
  await requireAdmin();
  return prisma.user.findMany({
    where: { role: "CLIENT", status: "ACTIVE" },
    orderBy: { firstName: "asc" },
    select: { id: true, firstName: true, lastName: true, company: true },
  });
}
