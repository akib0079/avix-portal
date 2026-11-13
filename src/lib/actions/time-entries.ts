"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/dal/session";
import { timeEntrySchema, type TimeEntryInput } from "@/lib/validation/time-entry";
import { parseDay } from "@/lib/board";
import { unbilledHours } from "@/lib/dal/billable";
import { refusedChange } from "@/lib/time-entry-lock";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** The schema guarantees the shape; parseDay also rejects impossible days. */
function parseDate(value: string): Date | null {
  return parseDay(value) ?? null;
}

function revalidateProject(projectId: string) {
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/portal/projects/${projectId}`);
}

/**
 * After a guarded write, from the entry read beside it. That read can miss
 * an entry the write (or someone else) just deleted; then every project
 * page is revalidated instead.
 */
function revalidateEntry(entry: { milestone: { projectId: string } } | null) {
  if (entry) return revalidateProject(entry.milestone.projectId);
  revalidatePath("/admin/projects", "layout");
  revalidatePath("/portal/projects", "layout");
}

// Time entries deliberately create NO notifications and NO emails — progress
// surfaces passively on the milestone board and the client's timeline.

/** The invoice line an entry is billed on, when that invoice still counts. */
const billedSelect = {
  invoiceItem: { select: { invoice: { select: { invoiceNumber: true, status: true } } } },
} as const;

/**
 * The entry's project and invoice, read in the same wave as a guarded write.
 * Listed first in that Promise.all, so a busy pool queues it ahead of the
 * write and it still sees an entry the write deletes.
 */
function findEntry(id: string) {
  return prisma.timeEntry.findUnique({
    where: { id },
    select: { milestone: { select: { projectId: true } }, ...billedSelect },
  });
}

export async function createTimeEntry(
  milestoneId: string,
  input: TimeEntryInput,
): Promise<ActionResult> {
  const viewer = await requireTeam();
  const parsed = timeEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const date = parseDate(data.date);
  if (!date) return { ok: false, error: "Pick a valid date" };

  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    select: { projectId: true, stage: true, archivedAt: true },
  });
  if (!milestone) return { ok: false, error: "Milestone not found." };
  // Hours on a request nobody has accepted, or on archived work, would bill
  // the client for something that isn't on their plan.
  if (milestone.stage === "REQUESTED") {
    return { ok: false, error: "Accept the request before logging time on it." };
  }
  if (milestone.archivedAt) {
    return { ok: false, error: "Restore this item before logging time on it." };
  }

  await prisma.timeEntry.create({
    data: {
      milestoneId,
      // Attribution powers "my hours this week" and utilisation reporting.
      userId: viewer.id,
      date,
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
  const viewer = await requireTeam();
  const parsed = timeEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const date = parseDate(data.date);
  if (!date) return { ok: false, error: "Pick a valid date" };

  // The lock is part of the write, so a bill that lands meanwhile can't be
  // edited under, and the read beside it only explains a refusal. The note
  // can always be edited; the hours and the date are what was billed.
  const [entry, { count }] = await Promise.all([
    findEntry(id),
    prisma.timeEntry.updateMany({
      where: { id, OR: [...unbilledHours.OR, { hours: data.hours, date }] },
      data: {
        date,
        hours: data.hours,
        note: data.note || null,
      },
    }),
  ]);
  if (count === 0) {
    return { ok: false, error: refusedChange(viewer.role, entry, "changing their hours or date") };
  }

  revalidateEntry(entry);
  return { ok: true };
}

export async function deleteTimeEntry(id: string): Promise<ActionResult> {
  const viewer = await requireTeam();
  // As in updateTimeEntry: only unbilled hours are deleted, in the write.
  const [entry, { count }] = await Promise.all([
    findEntry(id),
    prisma.timeEntry.deleteMany({ where: { id, ...unbilledHours } }),
  ]);
  if (count === 0) {
    return { ok: false, error: refusedChange(viewer.role, entry, "deleting them") };
  }

  revalidateEntry(entry);
  return { ok: true };
}
