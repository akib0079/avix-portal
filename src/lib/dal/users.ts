import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";

export type ClientHealth = "green" | "amber" | "red";

/**
 * Relationship health per client:
 *  red   — an unpaid invoice more than 7 days overdue
 *  amber — any overdue invoice, or an active project with no messages
 *          either way in 21+ days (relationship going quiet)
 *  green — everything current
 */
export async function listClients() {
  await requireAdmin();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const staleCutoff = new Date(now.getTime() - 21 * 86_400_000);

  const [clients, overdueInvoices, activeProjects, recentMessages] =
    await Promise.all([
      prisma.user.findMany({
        where: { role: "CLIENT" },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { projects: true, invoices: true } } },
      }),
      prisma.invoice.findMany({
        where: { status: { not: "PAID" }, dueDate: { not: null, lt: now } },
        select: { clientId: true, dueDate: true },
      }),
      prisma.project.findMany({
        where: { status: { in: ["IN_PROGRESS", "REVIEW"] }, clientId: { not: null } },
        select: { clientId: true },
      }),
      prisma.message.findMany({
        where: { createdAt: { gte: staleCutoff } },
        select: { clientId: true },
        distinct: ["clientId"],
      }),
    ]);

  const badlyOverdue = new Set(
    overdueInvoices.filter((i) => i.dueDate! < sevenDaysAgo).map((i) => i.clientId),
  );
  const anyOverdue = new Set(overdueInvoices.map((i) => i.clientId));
  const hasActiveProject = new Set(activeProjects.map((p) => p.clientId!));
  const recentlyTalked = new Set(recentMessages.map((m) => m.clientId));

  return clients.map((client) => {
    let health: ClientHealth = "green";
    if (badlyOverdue.has(client.id)) health = "red";
    else if (
      anyOverdue.has(client.id) ||
      (hasActiveProject.has(client.id) && !recentlyTalked.has(client.id))
    )
      health = "amber";
    return { ...client, health };
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
