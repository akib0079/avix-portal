import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";

export async function getAdminDashboard() {
  await requireAdmin();

  const [totalClients, totalProjects, totalInvoices, paidAgg, recentProjects, invoicesByStatus] =
    await Promise.all([
      prisma.user.count({ where: { role: "CLIENT" } }),
      prisma.project.count(),
      prisma.invoice.count(),
      prisma.invoice.aggregate({
        where: { status: "PAID" },
        _sum: { amount: true },
      }),
      prisma.project.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        include: {
          client: { select: { firstName: true, lastName: true, company: true } },
        },
      }),
      prisma.invoice.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
    ]);

  return {
    totalClients,
    totalProjects,
    totalInvoices,
    paidRevenue: Number(paidAgg._sum.amount ?? 0),
    recentProjects,
    invoicesByStatus: invoicesByStatus.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
  };
}
