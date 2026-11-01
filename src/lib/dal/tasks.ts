import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/dal/session";

/**
 * Internal to-dos. Every read here is team-scoped by requireTeam — there is no
 * client-facing counterpart and there must never be one, because the whole
 * point of Task is that it holds the things clients shouldn't see.
 */

export type TaskView = {
  id: string;
  title: string;
  notes: unknown;
  status: "TODO" | "DOING" | "DONE";
  priority: "HIGH" | "MEDIUM" | "LOW";
  origin: "MANUAL" | "SYSTEM";
  dueDate: string | null;
  snoozedUntil: string | null;
  completedAt: string | null;
  recurrence: "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";
  assignee: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  project: { id: string; projectName: string } | null;
  invoice: { id: string; invoiceNumber: string } | null;
  lead: { id: string; name: string } | null;
  subtasks: { id: string; title: string; done: boolean }[];
  createdAt: string;
};

/**
 * STAFF are money-blind, and invoice to-dos are money: "Chase payment on
 * INV-014" tells them which invoices exist and which are late. So anyone who
 * isn't an admin never gets a task linked to an invoice, or a SYSTEM task the
 * invoice duties made (systemKey "invoice-…"), from any read here, and the
 * task actions refuse to touch one. Keyed on "not ADMIN" rather than on
 * STAFF, so a role added later sees nothing about invoices either.
 *
 * Meant to sit in an AND list: it carries its own OR.
 */
export function taskVisibility(viewer: { role: string }): Prisma.TaskWhereInput {
  if (viewer.role === "ADMIN") return {};
  return {
    invoiceId: null,
    // NOT on its own would drop rows whose systemKey is null (SQL NULL), and
    // those are every task a person wrote.
    OR: [{ systemKey: null }, { NOT: { systemKey: { startsWith: "invoice" } } }],
  };
}

const include = {
  assignee: { select: { id: true, name: true } },
  client: { select: { id: true, name: true } },
  project: { select: { id: true, projectName: true } },
  invoice: { select: { id: true, invoiceNumber: true } },
  lead: { select: { id: true, name: true } },
  subtasks: { orderBy: { position: "asc" } as const },
} as const;

/** The invoice link is admin-only, so it isn't even loaded for anyone else. */
function includeFor(viewer: { role: string }) {
  return viewer.role === "ADMIN" ? include : { ...include, invoice: false as const };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toView(t: any): TaskView {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes ?? null,
    status: t.status,
    priority: t.priority,
    origin: t.origin,
    dueDate: t.dueDate?.toISOString() ?? null,
    snoozedUntil: t.snoozedUntil?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    recurrence: t.recurrence,
    assignee: t.assignee ?? null,
    client: t.client ?? null,
    project: t.project ?? null,
    invoice: t.invoice ?? null,
    lead: t.lead ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subtasks: (t.subtasks ?? []).map((s: any) => ({
      id: s.id,
      title: s.title,
      done: s.completedAt != null,
    })),
    createdAt: t.createdAt.toISOString(),
  };
}

export type TaskFilter = {
  /** Only tasks assigned to the viewer (or unassigned ones they created). */
  mine?: boolean;
  /** Include finished work. Off by default — a to-do list is what's left. */
  includeDone?: boolean;
};

/**
 * The list behind /admin/tasks.
 *
 * Snoozed tasks are returned rather than filtered out at the query level: the
 * page needs to show a "Snoozed (3)" affordance, and hiding them completely is
 * how a deferred task becomes a forgotten one. Bucketing happens in the page,
 * which owns the notion of "today" in the viewer's clock.
 */
export async function listTasks(filter: TaskFilter = {}): Promise<TaskView[]> {
  const viewer = await requireTeam();

  const rows = await prisma.task.findMany({
    where: {
      AND: [
        filter.includeDone ? {} : { status: { not: "DONE" as const } },
        filter.mine
          ? { OR: [{ assigneeId: viewer.id }, { assigneeId: null, createdById: viewer.id }] }
          : {},
        taskVisibility(viewer),
      ],
    },
    include: includeFor(viewer),
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { position: "asc" }, { createdAt: "desc" }],
    take: 500,
  });
  return rows.map(toView);
}

/** Recently finished work, for the "Done" drawer. Bounded on purpose. */
export async function listRecentlyDone(limit = 25): Promise<TaskView[]> {
  const viewer = await requireTeam();
  const rows = await prisma.task.findMany({
    where: { AND: [{ status: "DONE" }, taskVisibility(viewer)] },
    include: includeFor(viewer),
    orderBy: { completedAt: "desc" },
    take: limit,
  });
  return rows.map(toView);
}

export async function getTask(id: string): Promise<TaskView | null> {
  const viewer = await requireTeam();
  const row = await prisma.task.findFirst({
    where: { AND: [{ id }, taskVisibility(viewer)] },
    include: includeFor(viewer),
  });
  return row ? toView(row) : null;
}

/** Counts for the nav badge: what is actually demanding attention now. */
export async function countOpenTasks(): Promise<{ due: number; overdue: number }> {
  const viewer = await requireTeam();
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const notSnoozed = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };
  const mine = { OR: [{ assigneeId: viewer.id }, { assigneeId: null }] };
  const visible = taskVisibility(viewer);

  // AND, not spread: both clauses are keyed `OR`, so spreading them into one
  // object silently drops the first and the snooze filter stops applying.
  const [overdue, due] = await Promise.all([
    prisma.task.count({
      where: { status: { not: "DONE" }, dueDate: { lt: now }, AND: [notSnoozed, mine, visible] },
    }),
    prisma.task.count({
      where: {
        status: { not: "DONE" },
        dueDate: { gte: now, lte: endOfToday },
        AND: [notSnoozed, mine, visible],
      },
    }),
  ]);
  return { due, overdue };
}

/**
 * Context pickers for the task form. There is deliberately no invoice list
 * here: the form is shared with STAFF, who must not see invoices.
 */
export async function listTaskTargets() {
  await requireTeam();
  const [clients, projects, staff] = await Promise.all([
    prisma.user.findMany({
      where: { role: "CLIENT", status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: { status: { not: "COMPLETED" } },
      select: { id: true, projectName: true },
      orderBy: { projectName: "asc" },
    }),
    prisma.user.findMany({
      where: { role: { in: ["ADMIN", "STAFF"] }, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { clients, projects, staff };
}
