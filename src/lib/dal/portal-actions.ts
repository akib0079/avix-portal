import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Everything on the client's plate that needs a decision from them:
 *  - completed milestones awaiting their approval
 *  - sent invoices they haven't reported paying yet
 * Read-only aggregation — the actions themselves live in actions/portal.ts.
 */
export async function getClientActionItems(clientId: string) {
  const [milestones, invoices] = await Promise.all([
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
    count: milestones.length + invoices.length,
  };
}

/** Cheap badge count of pending client actions. */
export async function countClientActionItems(clientId: string): Promise<number> {
  const [milestones, invoices] = await Promise.all([
    prisma.milestone.count({
      where: { status: "COMPLETED", clientApprovedAt: null, project: { clientId } },
    }),
    prisma.invoice.count({
      where: { clientId, status: "SENT", paymentClaimedAt: null },
    }),
  ]);
  return milestones + invoices;
}

export type ClientActionItems = Awaited<ReturnType<typeof getClientActionItems>>;
