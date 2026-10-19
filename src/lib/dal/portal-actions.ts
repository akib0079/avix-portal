import "server-only";
import { prisma } from "@/lib/prisma";

/** Board cards waiting on the client: sent for review, or carrying our open question. */
function boardTasksWaiting(clientId: string) {
  return {
    project: { clientId },
    OR: [
      { status: "REVIEW" as const },
      { comments: { some: { kind: "HELP" as const, authorRole: "ADMIN" as const, resolvedAt: null } } },
    ],
  };
}

/**
 * Everything on the client's plate that needs a decision from them:
 *  - completed milestones awaiting their approval
 *  - sent invoices they haven't reported paying yet
 *  - board tasks in review, or with a question from the team
 * Read-only aggregation — the actions themselves live in actions/portal.ts.
 */
export async function getClientActionItems(clientId: string) {
  const [milestones, invoices, tasks] = await Promise.all([
    prisma.milestone.findMany({
      where: {
        status: "COMPLETED",
        clientApprovedAt: null,
        project: { clientId },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        project: { select: { id: true, projectName: true } },
      },
    }),
    prisma.invoice.findMany({
      where: {
        clientId,
        status: "SENT",
        paymentClaimedAt: null,
      },
      orderBy: { issueDate: "desc" },
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        currency: true,
        dueDate: true,
        project: { select: { projectName: true } },
      },
    }),
    prisma.projectTask.findMany({
      where: boardTasksWaiting(clientId),
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        project: { select: { id: true, projectName: true } },
      },
    }),
  ]);

  return {
    milestones: milestones.map((m) => ({
      id: m.id,
      title: m.title,
      projectId: m.project.id,
      projectName: m.project.projectName,
      updatedAt: m.updatedAt,
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      amount: Number(i.amount),
      currency: i.currency,
      dueDate: i.dueDate,
      projectName: i.project?.projectName ?? null,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      inReview: t.status === "REVIEW",
      projectId: t.project.id,
      projectName: t.project.projectName,
    })),
    count: milestones.length + invoices.length + tasks.length,
  };
}

/** Cheap badge count of pending client actions. */
export async function countClientActionItems(clientId: string): Promise<number> {
  const [milestones, invoices, tasks] = await Promise.all([
    prisma.milestone.count({
      where: { status: "COMPLETED", clientApprovedAt: null, project: { clientId } },
    }),
    prisma.invoice.count({
      where: { clientId, status: "SENT", paymentClaimedAt: null },
    }),
    prisma.projectTask.count({ where: boardTasksWaiting(clientId) }),
  ]);
  return milestones + invoices + tasks;
}

export type ClientActionItems = Awaited<ReturnType<typeof getClientActionItems>>;
