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
  const [projects, openInvoices, notifications, sentMessages, requests] =
    await Promise.all([
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
      // Onboarding checklist signals
      prisma.message.count({ where: { clientId: user.id, senderRole: "CLIENT" } }),
      prisma.taskRequest.count({ where: { clientId: user.id } }),
    ]);

  const [settledInvoices, record] = await Promise.all([
    // Ticked once they've actually paid (or told us they have).
    prisma.invoice.count({
      where: {
        clientId: user.id,
        OR: [{ status: "PAID" }, { paymentClaimedAt: { not: null } }],
      },
    }),
    // The session user doesn't carry onboardedAt — read it from the DB.
    prisma.user.findUnique({
      where: { id: user.id },
      select: { onboardedAt: true },
    }),
  ]);

  const checklist = {
    viewedProject: projects.length > 0,
    sentMessage: sentMessages > 0,
    seenPayment: settledInvoices > 0,
    submittedRequest: requests > 0,
  };

  return {
    user,
    onboardedAt: record?.onboardedAt ?? null,
    projects,
    openInvoices,
    notifications,
    checklist,
  };
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
    include: {
      milestones: {
        orderBy: { position: "asc" },
        include: { timeEntries: { orderBy: [{ date: "desc" }, { createdAt: "desc" }] } },
      },
    },
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
