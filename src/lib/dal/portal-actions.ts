import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AWAITING_RATING,
  AWAITING_REVIEW,
  INVOICE_TO_PAY,
  TEAM_QUESTION,
  countWaiting,
  creditNotesShown,
  isInvoiceToPay,
} from "@/lib/work-scope";
import { DECLINED_RECENT_DAYS, WITHDRAWN_NOTE } from "@/lib/work-list";
import { balanceDue, creditedTotal } from "@/lib/invoice-totals";
import { newestCapped } from "@/lib/action-center-lists";

const itemSelect = {
  id: true,
  title: true,
  updatedAt: true,
  project: { select: { id: true, projectName: true } },
} as const;

/** Deliverables the client hasn't approved or answered yet. */
export const DELIVERABLE_TO_REVIEW = { reviewStatus: null } as const;

/** Work items that wait on the client for any reason (review, question, rating). */
export const CLIENT_WAITING_ITEM = {
  OR: [AWAITING_REVIEW, TEAM_QUESTION, AWAITING_RATING],
} satisfies Prisma.MilestoneWhereInput;

/** What the work-scope predicates need to tell which reasons apply. */
export const waitingItemSelect = {
  stage: true,
  parentId: true,
  archivedAt: true,
  clientApprovedAt: true,
  clientRating: true,
  _count: { select: { comments: { where: TEAM_QUESTION.comments.some } } },
} satisfies Prisma.MilestoneSelect;

/**
 * Everything the "needs you" badge counts, as part of a select on the
 * client's own user row, so the count is one statement with whatever else
 * that read needs (countWaiting finishes it).
 */
export const clientWaitingSelect = {
  projects: {
    select: {
      milestones: { where: CLIENT_WAITING_ITEM, select: waitingItemSelect },
      _count: { select: { deliverables: { where: DELIVERABLE_TO_REVIEW } } },
    },
  },
  invoices: {
    where: INVOICE_TO_PAY,
    select: { status: true, amount: true, amountPaid: true, creditNotes: creditNotesShown },
  },
} satisfies Prisma.UserSelect;

/**
 * Each group shows this many rows. One more is read so the page can say
 * "50+" instead of a capped count that reads as the whole story; a handled
 * row makes room for the next one on the following render.
 */
const GROUP_CAP = 50;
const capped = <T>(rows: T[]) => ({ list: rows.slice(0, GROUP_CAP), more: rows.length > GROUP_CAP });

/**
 * Everything on the client's plate that needs something from them, each
 * with the one action it asks for:
 *  - work in review, waiting for their approval (approve / send back)
 *  - questions the team asked on a piece of work (answer)
 *  - approved milestones they haven't rated (rate)
 *  - deliverables they haven't reviewed (approve / ask for changes)
 *  - invoices sent or part-paid with a balance after payments and credit
 *    notes, not yet reported paid (pay)
 * plus, as news rather than a task, their requests the team declined in the
 * last few weeks, with the reason. The work rules come from work-scope.ts,
 * which the per-project "Needs you" box uses too, so the two can't disagree.
 * Read-only aggregation, in one wave — the actions live in actions/portal.ts,
 * actions/deliverables.ts and actions/project-board.tsx.
 */
export async function getClientActionItems(clientId: string) {
  const mine = { project: { clientId } };
  const since = new Date(Date.now() - DECLINED_RECENT_DAYS * 86_400_000);
  const [reviews, questions, toRate, row] = await Promise.all([
    prisma.milestone.findMany({
      where: { ...AWAITING_REVIEW, ...mine },
      orderBy: { updatedAt: "desc" },
      take: GROUP_CAP + 1,
      select: itemSelect,
    }),
    prisma.milestone.findMany({
      where: { ...TEAM_QUESTION, ...mine },
      orderBy: { updatedAt: "desc" },
      take: GROUP_CAP + 1,
      select: itemSelect,
    }),
    prisma.milestone.findMany({
      where: { ...AWAITING_RATING, ...mine },
      orderBy: { updatedAt: "desc" },
      take: GROUP_CAP + 1,
      select: itemSelect,
    }),
    // The rest hangs off the client's own row: one statement for the files,
    // the invoices, the declined requests and the projects "Ask again" offers.
    prisma.user.findUnique({
      where: { id: clientId },
      select: {
        projects: {
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            projectName: true,
            // Each project's newest; newestCapped picks the overall newest.
            deliverables: {
              where: DELIVERABLE_TO_REVIEW,
              orderBy: { createdAt: "desc" },
              take: GROUP_CAP + 1,
              select: { id: true, title: true, externalUrl: true, createdAt: true },
            },
          },
        },
        invoices: {
          where: INVOICE_TO_PAY,
          orderBy: [{ dueDate: "asc" }, { issueDate: "desc" }],
          take: GROUP_CAP + 1,
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            amount: true,
            amountPaid: true,
            currency: true,
            dueDate: true,
            project: { select: { projectName: true } },
            creditNotes: creditNotesShown,
          },
        },
        taskRequests: {
          // A request the client withdrew themselves is no news to them.
          where: { status: "REJECTED", resolvedAt: { gte: since }, adminNote: { not: WITHDRAWN_NOTE } },
          orderBy: { resolvedAt: "desc" },
          take: 10,
          select: {
            id: true,
            title: true,
            adminNote: true,
            resolvedAt: true,
            project: { select: { id: true, projectName: true } },
          },
        },
      },
    }),
  ]);
  const projects = row?.projects ?? [];
  const invoices = row?.invoices ?? [];
  const declined = row?.taskRequests ?? [];

  const item = (m: (typeof reviews)[number]) => ({
    id: m.id,
    title: m.title,
    projectId: m.project.id,
    projectName: m.project.projectName,
    updatedAt: m.updatedAt,
  });
  const now = Date.now();
  const toPay = invoices
    .map((i) => ({
      ...i,
      amount: Number(i.amount),
      amountPaid: Number(i.amountPaid),
      credited: creditedTotal(i.creditNotes),
    }))
    .filter(isInvoiceToPay);
  const [rev, ask, rate] = [capped(reviews), capped(questions), capped(toRate)];
  const files = newestCapped(
    projects.flatMap((p) => p.deliverables.map((d) => ({ ...d, project: { id: p.id, projectName: p.projectName } }))),
    GROUP_CAP,
  );
  return {
    reviews: rev.list.map(item),
    questions: ask.list.map(item),
    toRate: rate.list.map(item),
    deliverables: files.list.map((d) => ({
      id: d.id,
      title: d.title,
      external: !!d.externalUrl,
      createdAt: d.createdAt,
      projectId: d.project.id,
      projectName: d.project.projectName,
    })),
    invoices: toPay.slice(0, GROUP_CAP).map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      amount: i.amount,
      /** What's left to pay, after payments and credit notes. */
      balance: balanceDue(i.amount, i.amountPaid, i.credited),
      currency: i.currency,
      dueDate: i.dueDate,
      overdue: !!i.dueDate && i.dueDate.getTime() < now,
      projectName: i.project?.projectName ?? null,
    })),
    declined: declined.map((r) => ({
      id: r.id,
      title: r.title,
      note: r.adminNote,
      resolvedAt: r.resolvedAt,
      projectId: r.project.id,
      projectName: r.project.projectName,
    })),
    /** Which groups have more rows than they show. Invoices count only those still owed. */
    more: {
      reviews: rev.more,
      questions: ask.more,
      toRate: rate.more,
      deliverables: files.more,
      invoices: toPay.length > GROUP_CAP,
    },
    /** The client's projects, for "Ask again" on a declined request. */
    projects: projects.map((p) => ({ id: p.id, projectName: p.projectName })),
  };
}

/**
 * Badge count of what needs the client — the same rules, in one statement on
 * their own row. Invoices come back as their amounts and credit notes so "has
 * a balance" is decided by the same predicate as the list.
 */
export async function countClientActionItems(clientId: string): Promise<number> {
  const row = await prisma.user.findUnique({ where: { id: clientId }, select: clientWaitingSelect });
  return row ? countWaiting(row) : 0;
}

export type ClientActionItems = Awaited<ReturnType<typeof getClientActionItems>>;
