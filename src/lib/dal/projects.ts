import "server-only";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/dal/session";

/**
 * Projects are team-visible (ADMIN + STAFF), but STAFF is money-blind: the
 * stripping below happens SERVER-SIDE so prices never reach a staff session's
 * payload — hiding UI alone would not be enough.
 */

export async function listProjects() {
  const viewer = await requireTeam();
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, company: true } },
      _count: { select: { milestones: true } },
    },
  });
  if (viewer.role === "STAFF") {
    return projects.map((p) => ({ ...p, contractPrice: null }));
  }
  return projects;
}

/** How many recent time entries each milestone carries into the page. */
const RECENT_TIME_ENTRIES = 20;

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
          email: true,
          timezone: true,
        },
      },
      owner: { select: { id: true, firstName: true, lastName: true } },
      milestones: {
        orderBy: { position: "asc" },
        include: {
          assignee: { select: { firstName: true, lastName: true } },
          // Bounded: a long-running milestone can accumulate hundreds of
          // entries and the page only ever shows the recent ones. Totals come
          // from the aggregate below, not from this list.
          timeEntries: {
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            take: RECENT_TIME_ENTRIES,
          },
        },
      },
      invoices: { orderBy: { createdAt: "desc" } },
    },
  });
  if (project && viewer.role === "STAFF") {
    return {
      ...project,
      contractPrice: null,
      invoices: [],
      milestones: project.milestones.map((m) => ({
        ...m,
        pricingType: "NONE" as const,
        hourlyRate: null,
        fixedPrice: null,
        estimatedHours: null,
      })),
    };
  }
  return project;
}


export type ProjectWorkspace = Awaited<ReturnType<typeof getProjectWorkspace>>;

/**
 * Everything the project page's tabs need beyond the project itself: true
 * logged-hour totals (the milestone include is capped), open requests, the
 * next meeting, linked retainers, and the project's audit trail.
 *
 * Money-bearing pieces are omitted for STAFF, matching getProject.
 */
export async function getProjectWorkspace(projectId: string) {
  const viewer = await requireTeam();
  const isAdmin = viewer.role === "ADMIN";
  const now = new Date();

  const [hourTotals, requests, meetings, retainers, activity] = await Promise.all([
    prisma.timeEntry.groupBy({
      by: ["milestoneId"],
      where: { milestone: { projectId } },
      _sum: { hours: true },
    }),
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
            active: true,
            dayOfMonth: true,
          },
        })
      : Promise.resolve([]),
    prisma.activityEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, type: true, summary: true, link: true, createdAt: true },
    }),
  ]);

  return {
    /** milestoneId → total logged hours (all entries, not just the recent page). */
    loggedHoursByMilestone: Object.fromEntries(
      hourTotals.map((row) => [row.milestoneId, Number(row._sum.hours ?? 0)]),
    ) as Record<string, number>,
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
      active: r.active,
      dayOfMonth: r.dayOfMonth,
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
