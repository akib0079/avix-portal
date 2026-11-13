import "server-only";
import { prisma } from "@/lib/prisma";
import {
  AWAITING_RATING,
  AWAITING_REVIEW,
  INVOICE_TO_PAY,
  TEAM_QUESTION,
  isInvoiceToPay,
} from "@/lib/work-scope";
import { DECLINED_RECENT_DAYS, WITHDRAWN_NOTE } from "@/lib/work-list";
import { balanceDue, creditedTotal } from "@/lib/invoice-totals";
import { creditNotesShown } from "@/lib/dal/portal";

const itemSelect = {
  id: true,
  title: true,
  updatedAt: true,
  project: { select: { id: true, projectName: true } },
} as const;

/** Deliverables the client hasn't approved or answered yet. */
const DELIVERABLE_TO_REVIEW = { reviewStatus: null } as const;

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
  const [reviews, questions, toRate, deliverables, invoices, declined] = await Promise.all([
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
    prisma.deliverable.findMany({
      where: { ...DELIVERABLE_TO_REVIEW, ...mine },
      orderBy: { createdAt: "desc" },
      take: GROUP_CAP + 1,
      select: {
        id: true,
        title: true,
        externalUrl: true,
        createdAt: true,
        project: { select: { id: true, projectName: true } },
      },
    }),
    prisma.invoice.findMany({
      where: { clientId, ...INVOICE_TO_PAY },
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
    }),
    prisma.taskRequest.findMany({
      // A request the client withdrew themselves is no news to them.
      where: { clientId, status: "REJECTED", resolvedAt: { gte: since }, adminNote: { not: WITHDRAWN_NOTE } },
      orderBy: { resolvedAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        adminNote: true,
        resolvedAt: true,
        project: { select: { id: true, projectName: true } },
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
  const now = Date.now();
  const toPay = invoices
    .map((i) => ({
      ...i,
      amount: Number(i.amount),
      amountPaid: Number(i.amountPaid),
      credited: creditedTotal(i.creditNotes),
    }))
    .filter(isInvoiceToPay);
  const [rev, ask, rate, files] = [capped(reviews), capped(questions), capped(toRate), capped(deliverables)];
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
    /** Which groups have more rows than they show. Invoices go by the rows read. */
    more: {
      reviews: rev.more,
      questions: ask.more,
      toRate: rate.more,
      deliverables: files.more,
      invoices: invoices.length > GROUP_CAP,
    },
  };
}

/**
 * Cheap badge count of what needs the client — the same rules, counted in
 * the database where a count can say it all. Invoices come back as their
 * amounts and credit notes so "has a balance" is decided by the same
 * predicate as the list.
 */
export async function countClientActionItems(clientId: string): Promise<number> {
  const mine = { project: { clientId } };
  const [reviews, questions, toRate, deliverables, invoices] = await Promise.all([
    prisma.milestone.count({ where: { ...AWAITING_REVIEW, ...mine } }),
    prisma.milestone.count({ where: { ...TEAM_QUESTION, ...mine } }),
    prisma.milestone.count({ where: { ...AWAITING_RATING, ...mine } }),
    prisma.deliverable.count({ where: { ...DELIVERABLE_TO_REVIEW, ...mine } }),
    // Every open one: a client has a handful, and each needs its balance checked.
    prisma.invoice.findMany({
      where: { clientId, ...INVOICE_TO_PAY },
      select: { status: true, amount: true, amountPaid: true, creditNotes: creditNotesShown },
    }),
  ]);
  const toPay = invoices.filter((i) =>
    isInvoiceToPay({
      status: i.status,
      amount: Number(i.amount),
      amountPaid: Number(i.amountPaid),
      credited: creditedTotal(i.creditNotes),
    }),
  ).length;
  return reviews + questions + toRate + deliverables + toPay;
}

export type ClientActionItems = Awaited<ReturnType<typeof getClientActionItems>>;
