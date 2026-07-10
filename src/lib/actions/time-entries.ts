"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { timeEntrySchema, type TimeEntryInput } from "@/lib/validation/time-entry";

export type ActionResult = { ok: true } | { ok: false; error: string };

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function revalidateProject(projectId: string) {
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/portal/projects/${projectId}`);
}

// Time entries deliberately create NO notifications and NO emails — progress
// surfaces passively on the milestone board and the client's timeline.

export async function createTimeEntry(
  milestoneId: string,
  input: TimeEntryInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = timeEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    select: { projectId: true },
  });
  if (!milestone) return { ok: false, error: "Milestone not found." };

  await prisma.timeEntry.create({
    data: {
      milestoneId,
      date: parseDate(data.date),
      hours: data.hours,
      note: data.note || null,
    },
  });

  revalidateProject(milestone.projectId);
  return { ok: true };
}

export async function updateTimeEntry(
  id: string,
  input: TimeEntryInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = timeEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const entry = await prisma.timeEntry.findUnique({
    where: { id },
    select: { milestone: { select: { projectId: true } } },
  });
  if (!entry) return { ok: false, error: "Time entry not found." };

  await prisma.timeEntry.update({
    where: { id },
    data: {
      date: parseDate(data.date),
      hours: data.hours,
      note: data.note || null,
    },
  });

  revalidateProject(entry.milestone.projectId);
  return { ok: true };
}

export async function deleteTimeEntry(id: string): Promise<ActionResult> {
  await requireAdmin();
  const entry = await prisma.timeEntry.findUnique({
    where: { id },
    select: { milestone: { select: { projectId: true } } },
  });
  if (!entry) return { ok: false, error: "Time entry not found." };

  await prisma.timeEntry.delete({ where: { id } });

  revalidateProject(entry.milestone.projectId);
  return { ok: true };
}
