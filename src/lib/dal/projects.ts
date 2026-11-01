import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/dal/session";
import { PLAN_ITEM } from "@/lib/work-scope";

/**
 * Projects are team-visible (ADMIN + STAFF), but STAFF is money-blind: the
 * stripping below happens SERVER-SIDE so prices never reach a staff session's
 * payload — hiding UI alone would not be enough.
 */

export async function listProjects() {
  const viewer = await requireTeam();
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    // Bounded: the board renders them all, and an agency past 200 live projects needs filters, not a longer page.
    take: 200,
    include: {
      client: { select: { id: true, firstName: true, lastName: true, company: true } },
      owner: { select: { id: true, firstName: true, lastName: true } },
      // The plan's statuses only — enough for a progress bar on each card.
      milestones: { where: PLAN_ITEM, select: { status: true } },
      // Work still open, at any level: requests waiting, to do, in review.
      _count: { select: { milestones: { where: { archivedAt: null, stage: { not: "DONE" } } } } },
    },
  });
  return projects.map(({ milestones, _count, ...p }) => ({
    ...p,
    ...(viewer.role === "STAFF" ? { contractPrice: null } : {}),
    planTotal: milestones.length,
    planDone: milestones.filter((m) => m.status === "COMPLETED").length,
    openItems: _count.milestones,
  }));
}

/**
 * The project itself. Its work items load separately, through getWorkItems
 * (src/lib/dal/project-board.ts) — the one read both views and the poll use —
 * so the page doesn't load every milestone twice.
 */
export async function getProject(id: string) {
  const viewer = await requireTeam();
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          company: true,
          status: true,
          email: true,
          timezone: true,
        },
      },
      owner: { select: { id: true, firstName: true, lastName: true } },
      invoices: { orderBy: { createdAt: "desc" } },
    },
  });
  if (project && viewer.role === "STAFF") {
    return { ...project, contractPrice: null, invoices: [] };
  }
  return project;
}


export type ProjectWorkspace = Awaited<ReturnType<typeof getProjectWorkspace>>;

/**
 * Everything the project page's tabs need beyond the project and its work
 * items: the request history, the next meeting, linked retainers, and the
 * project's audit trail. (Logged hours come with the work items.)
 *
 * Money-bearing pieces are omitted for STAFF, matching getProject.
 */
const MONEY_ACTIVITY = [
  { type: { startsWith: "invoice." } },
  { type: { startsWith: "proposal." } },
  { type: { startsWith: "retainer." } },
] satisfies Prisma.ActivityEventWhereInput[];

export async function getProjectWorkspace(projectId: string) {
  const viewer = await requireTeam();
  const isAdmin = viewer.role === "ADMIN";
  const now = new Date();

  const [requests, meetings, retainers, activity] = await Promise.all([
    prisma.taskRequest.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        title: true,
        status: true,
        adminNote: true,
        createdAt: true,
        resolvedAt: true,
        milestone: { select: { id: true, title: true } },
      },
    }),
    prisma.meeting.findMany({
      where: { projectId, startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: { id: true, title: true, startsAt: true, durationMins: true },
    }),
    isAdmin
      ? prisma.retainer.findMany({
          where: { projectId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            amount: true,
            currency: true,
            active: true,
            dayOfMonth: true,
            frequency: true,
            interval: true,
          },
        })
      : Promise.resolve([]),
    prisma.activityEvent.findMany({
      // Invoice, proposal and plan entries carry amounts in their summaries.
      where: isAdmin ? { projectId } : { projectId, NOT: MONEY_ACTIVITY },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, type: true, summary: true, link: true, createdAt: true },
    }),
  ]);

  return {
    requests: requests.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      adminNote: r.adminNote,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      milestone: r.milestone,
    })),
    meetings: meetings.map((m) => ({
      id: m.id,
      title: m.title,
      startsAt: m.startsAt.toISOString(),
      durationMins: m.durationMins,
    })),
    retainers: retainers.map((r) => ({
      id: r.id,
      title: r.title,
      amount: Number(r.amount),
      currency: r.currency,
      active: r.active,
      dayOfMonth: r.dayOfMonth,
      frequency: r.frequency,
      interval: r.interval,
    })),
    activity: activity.map((a) => ({
      id: a.id,
      type: a.type,
      summary: a.summary,
      link: a.link,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}
