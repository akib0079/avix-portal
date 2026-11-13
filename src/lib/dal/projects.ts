import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/dal/session";
import { PLAN_ITEM } from "@/lib/work-scope";
import { deliverableSelect } from "@/lib/dal/deliverables";

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
      // With what each one's credit notes take off it (the Money tab).
      invoices: {
        orderBy: { createdAt: "desc" },
        include: { creditNotes: { select: { amount: true, status: true } } },
      },
    },
  });
  if (project && viewer.role === "STAFF") {
    return { ...project, contractPrice: null, invoices: [] };
  }
  return project;
}

/** The project page reads the project as getProject does. */
const projectClientSelect = {
  id: true,
  firstName: true,
  lastName: true,
  company: true,
  status: true,
  email: true,
  timezone: true,
} satisfies Prisma.UserSelect;

const projectOwnerSelect = { id: true, firstName: true, lastName: true } satisfies Prisma.UserSelect;

/**
 * What the project page's tabs show besides the work: the deliverables, the
 * request history, the next calls and, for ADMIN, the invoices and linked
 * retainers. relationJoins makes all of it one statement.
 */
function projectPageInclude(now: Date) {
  return {
    client: { select: projectClientSelect },
    owner: { select: projectOwnerSelect },
    deliverables: { orderBy: { createdAt: "desc" }, select: deliverableSelect },
    taskRequests: {
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
    },
    meetings: {
      where: { startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: { id: true, title: true, startsAt: true, durationMins: true },
    },
  } satisfies Prisma.ProjectInclude;
}

/** The money-bearing part: ADMIN only, never selected for STAFF. */
const projectMoneyInclude = {
  // With what each one's credit notes take off it (the Money tab).
  invoices: {
    orderBy: { createdAt: "desc" },
    include: { creditNotes: { select: { amount: true, status: true } } },
  },
  retainers: {
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
  },
} satisfies Prisma.ProjectInclude;

type ProjectPageRow = Prisma.ProjectGetPayload<{
  include: ReturnType<typeof projectPageInclude> & typeof projectMoneyInclude;
}>;

/**
 * The project page: the project and everything its tabs need beyond the
 * work items (getWorkItems), the thread (getProjectMessages) and the log
 * (getProjectActivity), in one statement. STAFF is money-blind: the invoices
 * and retainers aren't selected for them, and the contract price is blanked.
 */
export async function getProjectPage(id: string) {
  const viewer = await requireTeam();
  const include = projectPageInclude(new Date());
  if (viewer.role === "ADMIN") {
    const project = await prisma.project.findUnique({
      where: { id },
      include: { ...include, ...projectMoneyInclude },
    });
    return project && toProjectPage(project);
  }
  const project = await prisma.project.findUnique({ where: { id }, include });
  return project && toProjectPage({ ...project, contractPrice: null, invoices: [], retainers: [] });
}

function toProjectPage({ taskRequests, meetings, retainers, ...project }: ProjectPageRow) {
  return {
    ...project,
    requests: taskRequests.map((r) => ({
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
  };
}

/** Invoice, proposal and plan entries carry amounts in their summaries. */
const MONEY_ACTIVITY = [
  { type: { startsWith: "invoice." } },
  { type: { startsWith: "proposal." } },
  { type: { startsWith: "retainer." } },
] satisfies Prisma.ActivityEventWhereInput[];

/** The project's audit trail, newest first. Money entries are left out for STAFF. */
export async function getProjectActivity(projectId: string) {
  const viewer = await requireTeam();
  const activity = await prisma.activityEvent.findMany({
    where: viewer.role === "ADMIN" ? { projectId } : { projectId, NOT: MONEY_ACTIVITY },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, type: true, summary: true, link: true, createdAt: true },
  });
  return activity.map((a) => ({
    id: a.id,
    type: a.type,
    summary: a.summary,
    link: a.link,
    createdAt: a.createdAt.toISOString(),
  }));
}
