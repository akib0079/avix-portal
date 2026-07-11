import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";

export async function getAdminDashboard() {
  await requireAdmin();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    totalClients,
    activeProjects,
    totalInvoices,
    paidAgg,
    monthPaidAgg,
    outstandingAgg,
    pendingRequests,
    hoursAgg,
    recentProjects,
    invoicesByStatus,
    upcomingInvoices,
    recentActivity,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "CLIENT" } }),
    prisma.project.count({ where: { status: { not: "COMPLETED" } } }),
    prisma.invoice.count(),
    prisma.invoice.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
    prisma.invoice.aggregate({
      where: { status: "PAID", issueDate: { gte: startOfMonth } },
      _sum: { amount: true },
    }),
    prisma.invoice.aggregate({
      where: { status: { not: "PAID" } },
      _sum: { amount: true },
    }),
    prisma.taskRequest.count({ where: { status: "PENDING" } }),
    prisma.timeEntry.aggregate({
      where: { date: { gte: startOfMonth } },
      _sum: { hours: true },
    }),
    prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        client: { select: { firstName: true, lastName: true, company: true } },
      },
    }),
    prisma.invoice.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.invoice.findMany({
      where: { status: { not: "PAID" }, dueDate: { not: null, lte: soon } },
      orderBy: { dueDate: "asc" },
      take: 5,
      include: { client: { select: { firstName: true, lastName: true } } },
    }),
    prisma.notification.findMany({
      where: { user: { role: "ADMIN" } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, type: true, title: true, createdAt: true, link: true },
    }),
  ]);

  return {
    totalClients,
    activeProjects,
    totalInvoices,
    paidRevenue: Number(paidAgg._sum.amount ?? 0),
    revenueThisMonth: Number(monthPaidAgg._sum.amount ?? 0),
    outstanding: Number(outstandingAgg._sum.amount ?? 0),
    pendingRequests,
    hoursThisMonth: Number(hoursAgg._sum.hours ?? 0),
    recentProjects,
    invoicesByStatus: invoicesByStatus.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
    upcomingInvoices: upcomingInvoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: Number(inv.amount),
      dueDate: inv.dueDate!.toISOString(),
      clientName: `${inv.client.firstName} ${inv.client.lastName}`.trim(),
    })),
    recentActivity: recentActivity.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      createdAt: n.createdAt.toISOString(),
      link: n.link,
    })),
  };
}
