"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/dal/session";
import {
  taskSchema,
  quickTaskSchema,
  subtaskSchema,
  type TaskInput,
  type QuickTaskInput,
  type SubtaskInput,
  type SnoozePreset,
} from "@/lib/validation/task";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function refresh() {
  revalidatePath("/admin/tasks");
  revalidatePath("/admin");
}

/** Local midnight, so "due today" means the whole day and not this instant. */
function endOfDay(value: string): Date {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Quick capture. One field, no dialog, no context — the only version anyone
 * uses when the thought arrives mid-sentence. Everything else is editable
 * afterwards from the task itself.
 */
export async function quickAddTask(input: QuickTaskInput): Promise<ActionResult<{ id: string }>> {
  const viewer = await requireTeam();
  const parsed = quickTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const task = await prisma.task.create({
    data: {
      title: parsed.data.title,
      dueDate: parsed.data.dueDate ? endOfDay(parsed.data.dueDate) : null,
      createdById: viewer.id,
      assigneeId: viewer.id,
    },
    select: { id: true },
  });
  refresh();
  return { ok: true, data: task };
}

export async function createTask(input: TaskInput): Promise<ActionResult<{ id: string }>> {
  const viewer = await requireTeam();
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  const task = await prisma.task.create({
    data: {
      title: d.title,
      notes: (d.notes ?? undefined) as never,
      status: d.status,
      priority: d.priority,
      recurrence: d.recurrence,
      dueDate: d.dueDate ? endOfDay(d.dueDate) : null,
      assigneeId: d.assigneeId,
      clientId: d.clientId,
      projectId: d.projectId,
      invoiceId: d.invoiceId,
      leadId: d.leadId,
      createdById: viewer.id,
    },
    select: { id: true },
  });
  refresh();
  return { ok: true, data: task };
}

export async function updateTask(id: string, input: TaskInput): Promise<ActionResult> {
  await requireTeam();
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  const existing = await prisma.task.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { ok: false, error: "Task not found." };

  await prisma.task.update({
    where: { id },
    data: {
      title: d.title,
      notes: (d.notes ?? undefined) as never,
      status: d.status,
      priority: d.priority,
      recurrence: d.recurrence,
      dueDate: d.dueDate ? endOfDay(d.dueDate) : null,
      assigneeId: d.assigneeId,
      clientId: d.clientId,
      projectId: d.projectId,
      invoiceId: d.invoiceId,
      leadId: d.leadId,
    },
  });
  refresh();
  return { ok: true };
}

/**
 * Tick or untick a task.
 *
 * Completing a recurring task spawns the next occurrence rather than resetting
 * this one, so the history of what you actually did survives. recurredAt is the
 * guard: without it, ticking and unticking twice would fork two copies.
 */
export async function setTaskDone(id: string, done: boolean): Promise<ActionResult> {
  const viewer = await requireTeam();
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) return { ok: false, error: "Task not found." };

  await prisma.task.update({
    where: { id },
    data: { status: done ? "DONE" : "TODO", completedAt: done ? new Date() : null },
  });

  if (done && task.recurrence !== "NONE" && !task.recurredAt) {
    const next = nextOccurrence(task.dueDate ?? new Date(), task.recurrence);
    await prisma.$transaction([
      prisma.task.update({ where: { id }, data: { recurredAt: new Date() } }),
      prisma.task.create({
        data: {
          title: task.title,
          notes: task.notes ?? undefined,
          priority: task.priority,
          recurrence: task.recurrence,
          dueDate: next,
          assigneeId: task.assigneeId ?? viewer.id,
          clientId: task.clientId,
          projectId: task.projectId,
          invoiceId: task.invoiceId,
          leadId: task.leadId,
          createdById: task.createdById,
        },
      }),
    ]);
  }

  refresh();
  return { ok: true };
}

function nextOccurrence(from: Date, recurrence: string): Date {
  const d = new Date(from);
  switch (recurrence) {
    case "DAILY":
      d.setDate(d.getDate() + 1);
      break;
    case "WEEKLY":
      d.setDate(d.getDate() + 7);
      break;
    case "BIWEEKLY":
      d.setDate(d.getDate() + 14);
      break;
    case "MONTHLY":
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d;
}

export async function setTaskStatus(
  id: string,
  status: "TODO" | "DOING" | "DONE",
): Promise<ActionResult> {
  if (status === "DONE") return setTaskDone(id, true);
  await requireTeam();
  await prisma.task.update({
    where: { id },
    data: { status, completedAt: null },
  });
  refresh();
  return { ok: true };
}

/** Defer out of Today. Clearing (preset null) brings it straight back. */
export async function snoozeTask(
  id: string,
  preset: SnoozePreset | null,
): Promise<ActionResult> {
  await requireTeam();

  let until: Date | null = null;
  if (preset) {
    until = new Date();
    if (preset === "tomorrow") until.setDate(until.getDate() + 1);
    if (preset === "nextWeek") until.setDate(until.getDate() + 7);
    if (preset === "nextMonth") until.setMonth(until.getMonth() + 1);
    until.setHours(8, 0, 0, 0);
  }

  await prisma.task.update({ where: { id }, data: { snoozedUntil: until } });
  refresh();
  return { ok: true };
}

export async function deleteTask(id: string): Promise<ActionResult> {
  await requireTeam();
  await prisma.task.delete({ where: { id } });
  refresh();
  return { ok: true };
}

export async function addSubtask(input: SubtaskInput): Promise<ActionResult<{ id: string }>> {
  await requireTeam();
  const parsed = subtaskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const count = await prisma.subtask.count({ where: { taskId: parsed.data.taskId } });
  const row = await prisma.subtask.create({
    data: { taskId: parsed.data.taskId, title: parsed.data.title, position: count },
    select: { id: true },
  });
  refresh();
  return { ok: true, data: row };
}

export async function setSubtaskDone(id: string, done: boolean): Promise<ActionResult> {
  await requireTeam();
  await prisma.subtask.update({
    where: { id },
    data: { completedAt: done ? new Date() : null },
  });
  refresh();
  return { ok: true };
}

export async function deleteSubtask(id: string): Promise<ActionResult> {
  await requireTeam();
  await prisma.subtask.delete({ where: { id } });
  refresh();
  return { ok: true };
}

/** Persist a drag reorder within a bucket. */
export async function reorderTasks(ids: string[]): Promise<ActionResult> {
  await requireTeam();
  await prisma.$transaction(
    ids.map((id, position) => prisma.task.update({ where: { id }, data: { position } })),
  );
  refresh();
  return { ok: true };
}
