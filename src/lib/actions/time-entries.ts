"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/dal/session";
import type { SessionUser } from "@/lib/auth";
import { timeEntrySchema, type TimeEntryInput } from "@/lib/validation/time-entry";
import { parseDay } from "@/lib/board";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** The schema guarantees the shape; parseDay also rejects impossible days. */
function parseDate(value: string): Date | null {
  return parseDay(value) ?? null;
}

function revalidateProject(projectId: string) {
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/portal/projects/${projectId}`);
}

// Time entries deliberately create NO notifications and NO emails — progress
// surfaces passively on the milestone board and the client's timeline.

/** The invoice line an entry is billed on, when that invoice still counts. */
const billedSelect = {
  invoiceItem: { select: { invoice: { select: { invoiceNumber: true, status: true } } } },
} as const;

type Billed = { invoiceItem: { invoice: { invoiceNumber: string; status: string } } | null };

function liveInvoice(entry: Billed) {
  const invoice = entry.invoiceItem?.invoice;
  return invoice && invoice.status !== "CANCELLED" ? invoice : null;
}

/**
 * Billed hours are what an invoice charged for, so their hours and date
 * can't change under it (a cancelled invoice frees them). Staff are
 * money-blind: they are told the hours are locked, never by which invoice.
 */
function lockedMessage(viewer: SessionUser, invoiceNumber: string, change: string): string {
  return viewer.role === "ADMIN"
    ? `These hours are billed on ${invoiceNumber}. Take them off that invoice, or cancel it, before ${change}.`
    : `These hours are locked. Ask an admin if they need ${change === "deleting them" ? "deleting" : "changing"}.`;
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

  const entry = await prisma.timeEntry.findUnique({
    where: { id },
    select: {
      date: true,
      hours: true,
      milestone: { select: { projectId: true } },
      ...billedSelect,
    },
  });
  if (!entry) return { ok: false, error: "Time entry not found." };
  // The note can always be edited; the hours and the date are what was billed.
  const invoice = liveInvoice(entry);
  if (
    invoice &&
    (Number(entry.hours) !== data.hours || entry.date.toISOString().slice(0, 10) !== data.date)
  ) {
    return {
      ok: false,
      error: lockedMessage(viewer, invoice.invoiceNumber, "changing their hours or date"),
    };
  }

  await prisma.timeEntry.update({
    where: { id },
    data: {
      date,
      hours: data.hours,
      note: data.note || null,
    },
  });

  revalidateProject(entry.milestone.projectId);
  return { ok: true };
}

export async function deleteTimeEntry(id: string): Promise<ActionResult> {
  const viewer = await requireTeam();
  const entry = await prisma.timeEntry.findUnique({
    where: { id },
    select: { milestone: { select: { projectId: true } }, ...billedSelect },
  });
  if (!entry) return { ok: false, error: "Time entry not found." };
  const invoice = liveInvoice(entry);
  if (invoice) {
    return { ok: false, error: lockedMessage(viewer, invoice.invoiceNumber, "deleting them") };
  }

  await prisma.timeEntry.delete({ where: { id } });

  revalidateProject(entry.milestone.projectId);
  return { ok: true };
}
