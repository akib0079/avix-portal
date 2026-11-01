import "server-only";
import { prisma } from "@/lib/prisma";
import { AWAITING_RATING, AWAITING_REVIEW, TEAM_QUESTION } from "@/lib/work-scope";

const itemSelect = {
  id: true,
  title: true,
  updatedAt: true,
  project: { select: { id: true, projectName: true } },
} as const;

/**
 * Everything on the client's plate that needs a decision from them:
 *  - work in review, waiting for their approval
 *  - questions the team asked on a piece of work
 *  - approved milestones they haven't rated
 *  - sent invoices they haven't reported paying yet
 * The work rules come from work-scope.ts, which the per-project "Needs you"
 * box uses too, so the two can't disagree. Read-only aggregation — the
 * actions themselves live in actions/portal.ts and actions/project-board.tsx.
 */
export async function getClientActionItems(clientId: string) {
  const mine = { project: { clientId } };
  const [reviews, questions, toRate, invoices] = await Promise.all([
    prisma.milestone.findMany({
      where: { ...AWAITING_REVIEW, ...mine },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: itemSelect,
    }),
    prisma.milestone.findMany({
      where: { ...TEAM_QUESTION, ...mine },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: itemSelect,
    }),
    prisma.milestone.findMany({
      where: { ...AWAITING_RATING, ...mine },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: itemSelect,
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

  const item = (m: (typeof reviews)[number]) => ({
    id: m.id,
    title: m.title,
    projectId: m.project.id,
    projectName: m.project.projectName,
    updatedAt: m.updatedAt,
  });
  return {
    reviews: reviews.map(item),
    questions: questions.map(item),
    toRate: toRate.map(item),
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      amount: Number(i.amount),
      currency: i.currency,
      dueDate: i.dueDate,
      projectName: i.project?.projectName ?? null,
    })),
    count: reviews.length + questions.length + toRate.length + invoices.length,
  };
}

/** Cheap badge count of pending client actions. */
export async function countClientActionItems(clientId: string): Promise<number> {
  const mine = { project: { clientId } };
  const [reviews, questions, toRate, invoices] = await Promise.all([
    prisma.milestone.count({ where: { ...AWAITING_REVIEW, ...mine } }),
    prisma.milestone.count({ where: { ...TEAM_QUESTION, ...mine } }),
    prisma.milestone.count({ where: { ...AWAITING_RATING, ...mine } }),
    prisma.invoice.count({
      where: { clientId, status: "SENT", paymentClaimedAt: null },
    }),
  ]);
  return reviews + questions + toRate + invoices;
}

export type ClientActionItems = Awaited<ReturnType<typeof getClientActionItems>>;
