import "server-only";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/lib/dal/session";

/**
 * Every query here is scoped to the signed-in client's own id, taken from the
 * session — never from a parameter. Single-record lookups use findFirst with
 * the clientId in the where clause and read as 404 on miss.
 */

export async function getPortalOverview() {
  const user = await requireClient();
  const [projects, openInvoices, notifications] = await Promise.all([
    prisma.project.findMany({
      where: { clientId: user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        milestones: { select: { status: true } },
      },
    }),
    prisma.invoice.findMany({
      where: { clientId: user.id, status: { not: "PAID" } },
      orderBy: { issueDate: "desc" },
    }),
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);
  return { user, projects, openInvoices, notifications };
}

export async function listMyProjects() {
  const user = await requireClient();
  return prisma.project.findMany({
    where: { clientId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { milestones: { select: { status: true } } },
  });
}

export async function getMyProject(id: string) {
  const user = await requireClient();
  return prisma.project.findFirst({
    where: { id, clientId: user.id },
    include: { milestones: { orderBy: { position: "asc" } } },
  });
}

export async function listMyInvoices() {
  const user = await requireClient();
  return prisma.invoice.findMany({
    where: { clientId: user.id },
    orderBy: { issueDate: "desc" },
    include: { project: { select: { projectName: true } } },
  });
}

export async function getMyInvoice(id: string) {
  const user = await requireClient();
  return prisma.invoice.findFirst({
    where: { id, clientId: user.id },
    include: { project: { select: { id: true, projectName: true } } },
  });
}

export async function listMyProjectOptions() {
  const user = await requireClient();
  return prisma.project.findMany({
    where: { clientId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, projectName: true },
  });
}
