"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { milestoneSchema, type MilestoneInput } from "@/lib/validation/milestone";
import type { Prisma, MilestoneStatus } from "@prisma/client";

export type ActionResult = { ok: true } | { ok: false; error: string };

function pricingData(data: MilestoneInput) {
  return {
    pricingType: data.pricingType,
    hourlyRate: data.pricingType === "HOURLY" ? data.hourlyRate : null,
    estimatedHours: data.pricingType === "HOURLY" ? (data.estimatedHours ?? null) : null,
    fixedPrice: data.pricingType === "FIXED" ? data.fixedPrice : null,
  };
}

export async function createMilestone(
  projectId: string,
  input: MilestoneInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = milestoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { ok: false, error: "Project not found." };

  const last = await prisma.milestone.aggregate({
    where: { projectId },
    _max: { position: true },
  });

  await prisma.milestone.create({
    data: {
      projectId,
      title: data.title,
      description: (data.description as Prisma.InputJsonValue) ?? undefined,
      position: (last._max.position ?? -1) + 1,
      ...pricingData(data),
    },
  });

  revalidatePath(`/admin/projects/${projectId}`);
  return { ok: true };
}

export async function updateMilestone(
  id: string,
  input: MilestoneInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = milestoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const milestone = await prisma.milestone.findUnique({ where: { id } });
  if (!milestone) return { ok: false, error: "Milestone not found." };

  await prisma.milestone.update({
    where: { id },
    data: {
      title: data.title,
      description: (data.description as Prisma.InputJsonValue) ?? undefined,
      ...pricingData(data),
    },
  });

  revalidatePath(`/admin/projects/${milestone.projectId}`);
  return { ok: true };
}

export async function setMilestoneStatus(
  id: string,
  status: MilestoneStatus,
): Promise<ActionResult> {
  await requireAdmin();
  const milestone = await prisma.milestone.findUnique({ where: { id } });
  if (!milestone) return { ok: false, error: "Milestone not found." };

  await prisma.milestone.update({ where: { id }, data: { status } });
  revalidatePath(`/admin/projects/${milestone.projectId}`);
  return { ok: true };
}

export async function deleteMilestone(id: string): Promise<ActionResult> {
  await requireAdmin();
  const milestone = await prisma.milestone.findUnique({ where: { id } });
  if (!milestone) return { ok: false, error: "Milestone not found." };

  await prisma.milestone.delete({ where: { id } });
  revalidatePath(`/admin/projects/${milestone.projectId}`);
  return { ok: true };
}

export async function reorderMilestones(
  projectId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  await requireAdmin();

  const milestones = await prisma.milestone.findMany({
    where: { projectId },
    select: { id: true },
  });
  const valid = new Set(milestones.map((m) => m.id));
  if (
    orderedIds.length !== valid.size ||
    !orderedIds.every((id) => valid.has(id))
  ) {
    return { ok: false, error: "Milestone list is out of date — refresh the page." };
  }

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.milestone.update({ where: { id }, data: { position: index } }),
    ),
  );

  revalidatePath(`/admin/projects/${projectId}`);
  return { ok: true };
}
