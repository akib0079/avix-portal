"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { milestoneSchema, type MilestoneInput } from "@/lib/validation/milestone";
import {
  sendMilestoneCompletedEmail,
  sendMilestoneUpdatedEmail,
} from "@/lib/email/milestone-emails";
import type { Prisma, MilestoneStatus } from "@prisma/client";

const clientInclude = {
  project: {
    select: {
      id: true,
      projectName: true,
      client: {
        select: { id: true, firstName: true, email: true, status: true },
      },
    },
  },
} as const;

/** Active client of the milestone's project, or null for independent projects. */
function activeClient(milestone: {
  project: { client: { id: string; firstName: string; email: string; status: string } | null };
}) {
  const client = milestone.project.client;
  return client && client.status === "ACTIVE" ? client : null;
}

/**
 * JSON.stringify with recursively sorted object keys. Postgres jsonb does not
 * preserve key order, so a naive stringify comparison of stored vs incoming
 * Tiptap docs reports false differences.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

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

  const milestone = await prisma.milestone.findUnique({
    where: { id },
    include: clientInclude,
  });
  if (!milestone) return { ok: false, error: "Milestone not found." };

  const pricing = pricingData(data);
  await prisma.milestone.update({
    where: { id },
    data: {
      title: data.title,
      description: (data.description as Prisma.InputJsonValue) ?? undefined,
      ...pricing,
    },
  });

  // Automated "task details updated" email — only when something actually
  // changed, so re-saving an unchanged dialog doesn't spam the client.
  // description === undefined means "not touched" (Prisma skips the column).
  const descriptionChanged =
    data.description !== undefined &&
    stableStringify(milestone.description ?? null) !==
      stableStringify(data.description ?? null);
  const changed =
    milestone.title !== data.title ||
    descriptionChanged ||
    milestone.pricingType !== pricing.pricingType ||
    Number(milestone.hourlyRate ?? 0) !== Number(pricing.hourlyRate ?? 0) ||
    Number(milestone.estimatedHours ?? 0) !== Number(pricing.estimatedHours ?? 0) ||
    Number(milestone.fixedPrice ?? 0) !== Number(pricing.fixedPrice ?? 0);

  const client = activeClient(milestone);
  if (changed && client) {
    await prisma.notification.create({
      data: {
        userId: client.id,
        type: "MILESTONE_UPDATED",
        title: `Task updated: ${data.title}`,
        body: `on ${milestone.project.projectName}`,
        link: `/portal/projects/${milestone.projectId}`,
      },
    });
    await sendMilestoneUpdatedEmail({
      to: client.email,
      firstName: client.firstName,
      milestoneTitle: data.title,
      projectName: milestone.project.projectName,
      projectId: milestone.projectId,
    });
  }

  revalidatePath(`/admin/projects/${milestone.projectId}`);
  revalidatePath(`/portal/projects/${milestone.projectId}`);
  return { ok: true };
}

export async function setMilestoneStatus(
  id: string,
  status: MilestoneStatus,
): Promise<ActionResult> {
  await requireAdmin();
  const milestone = await prisma.milestone.findUnique({
    where: { id },
    include: clientInclude,
  });
  if (!milestone) return { ok: false, error: "Milestone not found." };

  await prisma.milestone.update({ where: { id }, data: { status } });

  // Automated "task done" response — only on the transition into COMPLETED.
  const client = activeClient(milestone);
  if (status === "COMPLETED" && milestone.status !== "COMPLETED" && client) {
    const [done, total] = await Promise.all([
      prisma.milestone.count({
        where: { projectId: milestone.projectId, status: "COMPLETED" },
      }),
      prisma.milestone.count({ where: { projectId: milestone.projectId } }),
    ]);
    await prisma.notification.create({
      data: {
        userId: client.id,
        type: "MILESTONE_COMPLETED",
        title: `Completed: ${milestone.title}`,
        body: `${done} of ${total} milestones done on ${milestone.project.projectName}`,
        link: `/portal/projects/${milestone.projectId}`,
      },
    });
    await sendMilestoneCompletedEmail({
      to: client.email,
      firstName: client.firstName,
      milestoneTitle: milestone.title,
      projectName: milestone.project.projectName,
      projectId: milestone.projectId,
      done,
      total,
    });
  }

  revalidatePath(`/admin/projects/${milestone.projectId}`);
  revalidatePath(`/portal/projects/${milestone.projectId}`);
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
