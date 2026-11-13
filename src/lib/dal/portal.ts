import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/lib/dal/session";
import { getBookingConfig } from "@/lib/dal/availability";
import { meetingViewInclude, toView } from "@/lib/dal/meetings";
import {
  CLIENT_WAITING_ITEM,
  DELIVERABLE_TO_REVIEW,
  waitingItemSelect,
} from "@/lib/dal/portal-actions";
import type { DeliverableRow } from "@/lib/dal/deliverables";
import { PLAN_ITEM, countInvoicesToPay, countWaitingItems, creditNotesShown } from "@/lib/work-scope";
import { creditedTotal } from "@/lib/invoice-totals";

/**
 * Every query here is scoped to the signed-in client's own id, taken from the
 * session — never from a parameter. Single-record lookups use findFirst with
 * the clientId in the where clause and read as 404 on miss.
 */

/**
 * A draft is an invoice still being prepared (duplicated, drafted from work or
 * by a plan): the client never sees one, in any list, total or link, until it
 * is sent. ASSIGNED invoices stay visible, as they always have been.
 */
const shownToClient = { not: "DRAFT" } as const;

export async function getPortalOverview() {
  const user = await requireClient();
  const now = new Date();
  // One wave: the client's own row carries nearly everything. The waiting
  // work is its own read, because the projects' milestones above are the plan
  // only, and the agency zone goes out alongside rather than after a miss.
  const [record, waiting, booking] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        // The session user doesn't carry these — read them from the DB.
        onboardedAt: true,
        timezone: true,
        projects: {
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            projectName: true,
            type: true,
            status: true,
            dueDate: true,
            // The plan only, so progress means the same here as on the project.
            milestones: { where: PLAN_ITEM, select: { status: true } },
            _count: { select: { deliverables: { where: DELIVERABLE_TO_REVIEW } } },
          },
        },
        // What they still owe: issued, not settled or void, and not a credit
        // note (that is money owed to them).
        invoices: {
          where: { status: { notIn: ["PAID", "CANCELLED", "DRAFT"] }, creditNoteForId: null },
          orderBy: { issueDate: "desc" },
          select: {
            id: true,
            amount: true,
            amountPaid: true,
            currency: true,
            dueDate: true,
            status: true,
            paymentClaimedAt: true,
            creditNotes: creditNotesShown,
          },
        },
        notifications: { orderBy: { createdAt: "desc" }, take: 6 },
        meetings: {
          where: { status: "SCHEDULED", startsAt: { gte: now } },
          orderBy: { startsAt: "asc" },
          take: 3,
          include: meetingViewInclude,
        },
        // Onboarding checklist signals.
        _count: {
          select: {
            clientMessages: { where: { senderRole: "CLIENT" } },
            taskRequests: true,
            // Ticked once they've actually paid (or told us they have).
            invoices: {
              where: {
                status: shownToClient,
                OR: [{ status: "PAID" }, { paymentClaimedAt: { not: null } }],
              },
            },
          },
        },
      },
    }),
    prisma.milestone.findMany({
      where: { project: { clientId: user.id }, ...CLIENT_WAITING_ITEM },
      select: waitingItemSelect,
    }),
    getBookingConfig(),
  ]);
  if (!record) redirect("/login");
  const { projects, invoices: openInvoices, notifications, _count: counts } = record;

  const checklist = {
    viewedProject: projects.length > 0,
    sentMessage: counts.clientMessages > 0,
    seenPayment: counts.invoices > 0,
    submittedRequest: counts.taskRequests > 0,
  };

  // The same rules as the Action Centre and the badge: work waiting on them,
  // files to review, and the open invoices that still have a balance to pay.
  const pendingActions =
    countWaitingItems(waiting) +
    projects.reduce((n, p) => n + p._count.deliverables, 0) +
    countInvoicesToPay(openInvoices);

  return {
    user,
    onboardedAt: record.onboardedAt,
    projects,
    openInvoices,
    notifications,
    checklist,
    meetings: record.meetings.map(toView),
    pendingActions,
    // The zone their browser reported (TimezoneSync), else the agency's.
    timezone: record.timezone || booking.agencyTimezone,
  };
}

export async function listMyProjects() {
  const user = await requireClient();
  return prisma.project.findMany({
    where: { clientId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { milestones: { where: PLAN_ITEM, select: { status: true } } },
  });
}

/**
 * The client's own project, with what the page shows beside the work: its
 * files, its invoices and its upcoming calls, in one statement. Its work
 * items load separately, through getWorkItems (src/lib/dal/project-board.ts),
 * scoped to the same session. Null when it isn't theirs.
 */
export async function getMyProjectPage(id: string) {
  const user = await requireClient();
  const now = new Date();
  const row = await prisma.project.findFirst({
    where: { id, clientId: user.id },
    include: {
      // The zone their browser reported (TimezoneSync), for rendering call times.
      client: { select: { timezone: true } },
      // listByProject's rows and order (src/lib/dal/deliverables.ts).
      deliverables: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          filePath: true,
          fileOriginalName: true,
          externalUrl: true,
          reviewStatus: true,
          reviewNote: true,
          reviewedAt: true,
          createdAt: true,
        } satisfies Record<keyof DeliverableRow, true>,
      },
      invoices: {
        where: { clientId: user.id, status: shownToClient },
        orderBy: { issueDate: "desc" },
        select: {
          id: true,
          invoiceNumber: true,
          issueDate: true,
          dueDate: true,
          amount: true,
          // Without this the portal cannot know what currency it is showing, so
          // it showed dollars for everything.
          currency: true,
          status: true,
          creditNoteForId: true,
          // The Action Centre's balance rules, so "Pay 1 invoice" here agrees
          // with it: not once reported paid, and not once paid or credited off.
          amountPaid: true,
          paymentClaimedAt: true,
          creditNotes: creditNotesShown,
        },
      },
      meetings: {
        where: { clientId: user.id, startsAt: { gte: now } },
        orderBy: { startsAt: "asc" },
        take: 5,
        select: { id: true, title: true, startsAt: true, durationMins: true },
      },
    },
  });
  if (!row) return null;
  const { client, deliverables, invoices, meetings, ...project } = row;
  // Not captured yet (first visit): the agency's zone beats the server's UTC.
  const timezone = client?.timezone || (await getBookingConfig()).agencyTimezone;

  return {
    project,
    deliverables,
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      issueDate: i.issueDate.toISOString(),
      dueDate: i.dueDate?.toISOString() ?? null,
      amount: Number(i.amount),
      currency: i.currency,
      status: i.status,
      creditNoteForId: i.creditNoteForId,
      amountPaid: Number(i.amountPaid),
      paymentClaimedAt: i.paymentClaimedAt?.toISOString() ?? null,
      credited: creditedTotal(i.creditNotes),
    })),
    meetings: meetings.map((m) => ({
      id: m.id,
      title: m.title,
      startsAt: m.startsAt.toISOString(),
      durationMins: m.durationMins,
    })),
    timezone,
  };
}

/**
 * The zone the signed-in client's meeting times render in: their own (captured
 * from the browser by TimezoneSync), else the agency's. Always a real zone, so
 * server-rendered times never fall back to the host's UTC and SSR matches
 * hydration in client components.
 */
export async function getMyTimezone(): Promise<string> {
  const user = await requireClient();
  // Together, not one after the other on a first visit.
  const [me, booking] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { timezone: true } }),
    getBookingConfig(),
  ]);
  return me?.timezone || booking.agencyTimezone;
}

export async function listMyInvoices() {
  const user = await requireClient();
  return prisma.invoice.findMany({
    where: { clientId: user.id, status: shownToClient },
    orderBy: { issueDate: "desc" },
    select: {
      id: true,
      invoiceNumber: true,
      issueDate: true,
      dueDate: true,
      amount: true,
      amountPaid: true,
      currency: true,
      status: true,
      pdfPath: true,
      pdfExternalUrl: true,
      creditNoteForId: true,
      project: { select: { projectName: true } },
      creditNotes: creditNotesShown,
    },
  });
}

export async function getMyInvoice(id: string) {
  const user = await requireClient();
  return prisma.invoice.findFirst({
    where: { id, clientId: user.id, status: shownToClient },
    select: {
      id: true,
      invoiceNumber: true,
      issueDate: true,
      dueDate: true,
      amount: true,
      amountPaid: true,
      currency: true,
      status: true,
      notes: true,
      pdfPath: true,
      pdfExternalUrl: true,
      paymentClaimedAt: true,
      paymentAccountId: true,
      payLinkUrl: true,
      creditNoteForId: true,
      project: { select: { id: true, projectName: true } },
      creditNoteFor: { select: { id: true, invoiceNumber: true } },
      creditNotes: creditNotesShown,
    },
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
