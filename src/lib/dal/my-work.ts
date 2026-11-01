import "server-only";
import type { Priority, ProjectBillingType, ProjectTaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/dal/session";
import { dayKey } from "@/lib/board";

/** A piece of project work with this person's name on it. */
export type MyWorkItem = {
  id: string;
  title: string;
  /** Board column; never DONE here. */
  stage: ProjectTaskStatus;
  priority: Priority | null;
  /** "YYYY-MM-DD" — a calendar day. */
  dueDate: string | null;
  projectId: string;
  projectName: string;
  /** For accepting a request from here: pricing is off on fixed contracts. */
  projectBillingType: ProjectBillingType;
  clientName: string | null;
  loggedHours: number;
  /** Null for STAFF, who are money-blind, and when there's no estimate. */
  estimatedHours: number | null;
  /** The client asked for help on it and nobody has answered. */
  clientNeedsHelp: boolean;
  /** Set while it's a client's request waiting for a decision (stage REQUESTED). */
  sourceTaskRequestId: string | null;
};

export type MyWork = {
  userId: string;
  items: MyWorkItem[];
  ownedProjects: { id: string; projectName: string; status: string; dueDate: string | null }[];
  hoursThisWeek: number;
  hoursLastWeek: number;
};

/** Monday 00:00 of the week containing `date`, in server local time. */
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
}

/**
 * One person's plate: the work assigned to them (one list since v49 — the
 * board cards and the milestones are the same rows), the projects they own,
 * and how much time they logged this week vs last. Scoped to the caller — an
 * `of` id is only honoured for admins, so staff can't read each other.
 */
export async function getMyWork(of?: string): Promise<MyWork> {
  const viewer = await requireTeam();
  const userId = viewer.role === "ADMIN" && of ? of : viewer.id;
  const showEstimates = viewer.role === "ADMIN";

  const thisWeek = startOfWeek(new Date());
  const lastWeek = new Date(thisWeek);
  lastWeek.setDate(lastWeek.getDate() - 7);

  const open = { assigneeId: userId, stage: { not: "DONE" as const }, archivedAt: null };
  const [items, hours, ownedProjects, weekEntries] = await Promise.all([
    prisma.milestone.findMany({
      where: open,
      orderBy: [{ dueDate: "asc" }, { position: "asc" }],
      take: 150,
      select: {
        id: true,
        title: true,
        stage: true,
        priority: true,
        dueDate: true,
        estimatedHours: true,
        sourceTaskRequestId: true,
        project: {
          select: {
            id: true,
            projectName: true,
            billingType: true,
            client: { select: { firstName: true, lastName: true, company: true } },
          },
        },
        _count: {
          select: {
            comments: { where: { kind: "HELP", resolvedAt: null, authorRole: "CLIENT" } },
          },
        },
      },
    }),
    // Summed in the database: a long-running item can carry hundreds of entries.
    prisma.timeEntry.groupBy({
      by: ["milestoneId"],
      where: { milestone: open },
      _sum: { hours: true },
    }),
    prisma.project.findMany({
      where: { ownerId: userId, status: { not: "COMPLETED" } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 50,
      select: { id: true, projectName: true, status: true, dueDate: true },
    }),
    prisma.timeEntry.findMany({
      where: { userId, date: { gte: lastWeek } },
      select: { hours: true, date: true },
    }),
  ]);

  const logged = new Map(hours.map((h) => [h.milestoneId, Number(h._sum.hours ?? 0)]));
  const sum = (from: Date, to?: Date) =>
    weekEntries
      .filter((e) => e.date >= from && (!to || e.date < to))
      .reduce((total, e) => total + Number(e.hours), 0);

  return {
    userId,
    items: items.map((m) => ({
      id: m.id,
      title: m.title,
      stage: m.stage,
      priority: m.priority,
      dueDate: m.dueDate ? dayKey(m.dueDate) : null,
      projectId: m.project.id,
      projectName: m.project.projectName,
      projectBillingType: m.project.billingType,
      clientName: m.project.client
        ? m.project.client.company ||
          `${m.project.client.firstName} ${m.project.client.lastName}`.trim()
        : null,
      loggedHours: logged.get(m.id) ?? 0,
      estimatedHours:
        showEstimates && m.estimatedHours != null ? Number(m.estimatedHours) : null,
      clientNeedsHelp: m._count.comments > 0,
      sourceTaskRequestId: m.stage === "REQUESTED" ? m.sourceTaskRequestId : null,
    })),
    ownedProjects: ownedProjects.map((p) => ({
      id: p.id,
      projectName: p.projectName,
      status: p.status,
      dueDate: p.dueDate?.toISOString() ?? null,
    })),
    hoursThisWeek: sum(thisWeek),
    hoursLastWeek: sum(lastWeek, thisWeek),
  };
}
