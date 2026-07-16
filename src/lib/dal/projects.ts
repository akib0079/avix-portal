import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";

export async function listProjects() {
  await requireAdmin();
  return prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, company: true } },
      _count: { select: { milestones: true } },
    },
  });
}

export async function getProject(id: string) {
  await requireAdmin();
  return prisma.project.findUnique({
    where: { id },
    include: {
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          company: true,
          email: true,
          timezone: true,
        },
      },
      milestones: {
        orderBy: { position: "asc" },
        include: { timeEntries: { orderBy: [{ date: "desc" }, { createdAt: "desc" }] } },
      },
      invoices: { orderBy: { createdAt: "desc" } },
    },
  });
}
