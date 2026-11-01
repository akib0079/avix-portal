import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/lib/dal/session";
import { getBookingConfig } from "@/lib/dal/availability";
import { PLAN_ITEM } from "@/lib/work-scope";

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

/** What a credit note takes off its invoice, for the balance the client sees. */
const creditNotesShown = {
  where: { status: { notIn: ["DRAFT", "CANCELLED"] } },
  select: { amount: true, status: true },
} satisfies Prisma.Invoice$creditNotesArgs;

export async function getPortalOverview() {
  const user = await requireClient();
  // One wave: these used to be two sequential Promise.alls, though nothing in
  // the second depended on the first.
  const [projects, openInvoices, notifications, sentMessages, requests, settledInvoices, record] =
    await Promise.all([
      prisma.project.findMany({
        where: { clientId: user.id },
        orderBy: { updatedAt: "desc" },
        include: {
          // The plan only, so progress means the same here as on the project.
          milestones: { where: PLAN_ITEM, select: { status: true } },
        },
      }),
      // What they still owe: issued, not settled or void, and not a credit
      // note (that is money owed to them).
      prisma.invoice.findMany({
        where: {
          clientId: user.id,
          status: { notIn: ["PAID", "CANCELLED", "DRAFT"] },
          creditNoteForId: null,
        },
        orderBy: { issueDate: "desc" },
        select: {
          id: true,
          amount: true,
          amountPaid: true,
          currency: true,
          dueDate: true,
          creditNotes: creditNotesShown,
        },
      }),
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      // Onboarding checklist signals
      prisma.message.count({ where: { clientId: user.id, senderRole: "CLIENT" } }),
      prisma.taskRequest.count({ where: { clientId: user.id } }),
      // Ticked once they've actually paid (or told us they have).
      prisma.invoice.count({
        where: {
          clientId: user.id,
          status: shownToClient,
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
    include: { milestones: { where: PLAN_ITEM, select: { status: true } } },
  });
}

/**
 * The client's own project. Its work items load separately, through
 * getWorkItems (src/lib/dal/project-board.ts), scoped to the same session.
 */
export async function getMyProject(id: string) {
  const user = await requireClient();
  return prisma.project.findFirst({
    where: { id, clientId: user.id },
  });
}

/**
 * The extras the project page shows beside the work: this project's invoices
 * and its upcoming calls. Scoped to the signed-in client.
 */
export async function getMyProjectExtras(projectId: string) {
  const user = await requireClient();
  const now = new Date();

  const [invoices, meetings, viewer] = await Promise.all([
    prisma.invoice.findMany({
      where: { projectId, clientId: user.id, status: shownToClient },
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
      },
    }),
    prisma.meeting.findMany({
      where: { projectId, clientId: user.id, startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: { id: true, title: true, startsAt: true, durationMins: true },
    }),
    // The zone their browser reported (TimezoneSync), for rendering call times.
    prisma.user.findUnique({ where: { id: user.id }, select: { timezone: true } }),
  ]);
  // Not captured yet (first visit): the agency's zone beats the server's UTC.
  const timezone = viewer?.timezone || (await getBookingConfig()).agencyTimezone;

  return {
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      issueDate: i.issueDate.toISOString(),
      dueDate: i.dueDate?.toISOString() ?? null,
      amount: Number(i.amount),
      currency: i.currency,
      status: i.status,
      creditNoteForId: i.creditNoteForId,
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
