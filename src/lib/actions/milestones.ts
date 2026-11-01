"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireTeam } from "@/lib/dal/session";
import { milestoneSchema, type MilestoneInput } from "@/lib/validation/milestone";
import { logActivity } from "@/lib/dal/activity";
import type { Prisma, MilestoneStatus, ProjectTaskStatus } from "@prisma/client";
import { stageToStatus, stageWrite, statusToStage } from "@/lib/work-stage";
import {
  approvalAfterMove,
  canMoveWorkItem,
  parentProblem,
  parseDay,
  workItemHref,
  workRole,
} from "@/lib/board";
import {
  NO_PRICING,
  archiveTree,
  endOfColumn,
  hasHistory,
  later,
  placeNew,
  pricingColumns,
} from "@/lib/work-items";

/**
 * The Milestones list's writes. A milestone is the one work item (v49): the
 * board shows the same rows, so every stage change here goes through
 * stageWrite() and lands at the end of its board column, and the board's own
 * rules (canMoveWorkItem) apply to it too.
 */

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

/**
 * "none"/empty clears the field (null); anything else must be an active team
 * member or the client of the project in `scope` — the same people the board
 * lets you pin ("there's a task for you"). undefined means "not allowed", so
 * the caller can say so: this used to return null for a client, and saving a
 * client's item from the list silently unassigned them.
 */
async function resolveAssignee(
  value: string | null | undefined,
  scope: Prisma.ProjectWhereInput,
): Promise<string | null | undefined> {
  if (!value || value === "none") return null;
  const user = await prisma.user.findFirst({
    where: {
      id: value,
      status: "ACTIVE",
      OR: [{ role: { in: ["ADMIN", "STAFF"] } }, { role: "CLIENT", projects: { some: scope } }],
    },
    select: { id: true },
  });
  return user?.id;
}

const NOT_ASSIGNABLE = { ok: false as const, error: "That person can't be assigned here." };

/** null/"none" = top level; undefined = not given. */
function parentChoice(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return !value || value === "none" ? null : value;
}

/** Why `parentId` can't hold this item, or null when it can (or isn't set). */
async function checkParent(
  parentId: string | null | undefined,
  projectId: string,
  item: { id?: string; childCount: number },
): Promise<string | null> {
  if (!parentId) return null;
  const parent = await prisma.milestone.findUnique({
    where: { id: parentId },
    select: { id: true, projectId: true, parentId: true, stage: true, archivedAt: true },
  });
  return parentProblem(item, parent, projectId);
}

function revalidateProject(projectId: string) {
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/portal/projects/${projectId}`);
}

export async function createMilestone(
  projectId: string,
  input: MilestoneInput,
): Promise<ActionResult> {
  const viewer = await requireTeam();
  const parsed = milestoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const stage: ProjectTaskStatus = data.stage ?? "TODO";
  const parentId = parentChoice(data.parentId) ?? null;

  const [project, assigneeId, parentError, place] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }),
    resolveAssignee(data.assigneeId, { id: projectId }),
    checkParent(parentId, projectId, { childCount: 0 }),
    placeNew(projectId, stage),
  ]);
  if (!project) return { ok: false, error: "Project not found." };
  if (assigneeId === undefined) return NOT_ASSIGNABLE;
  if (parentError) return { ok: false, error: parentError };

  await prisma.milestone.create({
    data: {
      projectId,
      title: data.title,
      description: (data.description as Prisma.InputJsonValue) ?? undefined,
      ...stageWrite(stage),
      position: place.position,
      boardPosition: place.boardPosition,
      priority: data.priority ?? null,
      parentId,
      assigneeId,
      dueDate: parseDay(data.dueDate) ?? null,
      createdById: viewer.id,
      createdByRole: "ADMIN",
      // Staff are money-blind: any pricing they submit is discarded.
      ...(viewer.role === "ADMIN" ? pricingColumns(data) : NO_PRICING),
    },
  });

  revalidateProject(projectId);
  return { ok: true };
}

export async function updateMilestone(
  id: string,
  input: MilestoneInput,
): Promise<ActionResult> {
  const viewer = await requireTeam();
  const parsed = milestoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const role = workRole(viewer.role)!;

  const milestone = await prisma.milestone.findUnique({
    where: { id },
    include: { ...clientInclude, _count: { select: { children: { where: { archivedAt: null } } } } },
  });
  if (!milestone) return { ok: false, error: "Milestone not found." };
  if (milestone.archivedAt) return { ok: false, error: "This milestone is archived — restore it first." };

  const nextStage = data.stage && data.stage !== milestone.stage ? data.stage : null;
  if (nextStage) {
    const move = canMoveWorkItem({ role }, milestone, milestone.stage, nextStage);
    if (!move.ok) return { ok: false, error: move.error };
  }
  const parentId = parentChoice(data.parentId);
  const [assigneeId, parentError, boardPosition] = await Promise.all([
    resolveAssignee(data.assigneeId, { id: milestone.projectId }),
    checkParent(parentId, milestone.projectId, { id, childCount: milestone._count.children }),
    nextStage ? endOfColumn(milestone.projectId, nextStage) : null,
  ]);
  if (assigneeId === undefined) return NOT_ASSIGNABLE;
  if (parentError) return { ok: false, error: parentError };

  // Staff edits keep the stored pricing untouched (they never see it anyway).
  const pricing =
    viewer.role === "ADMIN"
      ? pricingColumns(data)
      : {
          pricingType: milestone.pricingType,
          hourlyRate: milestone.hourlyRate,
          estimatedHours: milestone.estimatedHours,
          fixedPrice: milestone.fixedPrice,
        };
  await prisma.milestone.update({
    where: { id },
    data: {
      title: data.title,
      description: (data.description as Prisma.InputJsonValue) ?? undefined,
      assigneeId,
      dueDate: parseDay(data.dueDate) ?? null,
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      ...(nextStage
        ? {
            ...stageWrite(nextStage, milestone),
            clientApprovedAt: approvalAfterMove(nextStage, role, milestone.clientApprovedAt),
            boardPosition: boardPosition!,
          }
        : {}),
      ...pricing,
    },
  });

  // Automated "task details updated" notice — only when something actually
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

  // In-app notification only (no email) — clients found per-milestone emails
  // noisy, so milestone changes surface via the notification bell instead.
  // A request still waiting for a decision isn't the client's work item yet.
  const client = activeClient(milestone);
  if (changed && client && milestone.stage !== "REQUESTED") {
    later(() =>
      prisma.notification.create({
        data: {
          userId: client.id,
          type: "MILESTONE_UPDATED",
          title: `Task updated: ${data.title}`,
          body: `on ${milestone.project.projectName}`,
          link: workItemHref(milestone.projectId, milestone.id, "CLIENT", "list"),
        },
      }),
    );
  }

  revalidateProject(milestone.projectId);
  return { ok: true };
}

/**
 * The list's three-state picker. Mapped onto the board's stages: picking the
 * state an item is already in (In review and Done are both "Completed")
 * leaves its stage alone.
 */
export async function setMilestoneStatus(
  id: string,
  status: MilestoneStatus,
): Promise<ActionResult> {
  const viewer = await requireTeam();
  const role = workRole(viewer.role)!;
  const milestone = await prisma.milestone.findUnique({
    where: { id },
    include: clientInclude,
  });
  if (!milestone) return { ok: false, error: "Milestone not found." };

  const next = stageToStatus(milestone.stage) === status ? milestone.stage : statusToStage(status);
  if (next === milestone.stage) return { ok: true };
  const move = canMoveWorkItem({ role }, milestone, milestone.stage, next);
  if (!move.ok) return { ok: false, error: move.error };

  await prisma.milestone.update({
    where: { id },
    data: {
      ...stageWrite(next, milestone),
      clientApprovedAt: approvalAfterMove(next, role, milestone.clientApprovedAt),
      boardPosition: await endOfColumn(milestone.projectId, next),
    },
  });

  // In-app notification only (no email) on the transition into COMPLETED —
  // progress shows in the notification bell; no per-milestone emails.
  const client = activeClient(milestone);
  if (status === "COMPLETED" && milestone.status !== "COMPLETED" && client) {
    later(async () => {
      // Progress counts the plan: accepted, live, top-level work.
      const plan = {
        projectId: milestone.projectId,
        parentId: null,
        archivedAt: null,
        stage: { not: "REQUESTED" as const },
      };
      const [done, total] = await Promise.all([
        prisma.milestone.count({ where: { ...plan, status: "COMPLETED" } }),
        prisma.milestone.count({ where: plan }),
      ]);
      await prisma.notification.create({
        data: {
          userId: client.id,
          type: "MILESTONE_COMPLETED",
          title: `Completed: ${milestone.title}`,
          body: `${done} of ${total} milestones done on ${milestone.project.projectName}`,
          link: workItemHref(milestone.projectId, milestone.id, "CLIENT", "list"),
        },
      });
      await logActivity({
        type: "milestone.completed",
        summary: `Milestone completed: ${milestone.title} (${milestone.project.projectName})`,
        actorId: viewer.id,
        clientId: client.id,
        projectId: milestone.projectId,
        entity: "milestone",
        entityId: milestone.id,
        link: workItemHref(milestone.projectId, milestone.id, "ADMIN", "list"),
      });
    });
  }

  revalidateProject(milestone.projectId);
  return { ok: true };
}

/** Reassign from the milestone row without opening the edit dialog. */
export async function setMilestoneAssignee(
  id: string,
  assigneeId: string | null,
): Promise<ActionResult> {
  await requireTeam();
  const [milestone, resolved] = await Promise.all([
    prisma.milestone.findUnique({ where: { id }, select: { id: true, projectId: true } }),
    // The client of the project this milestone is on, or the team.
    resolveAssignee(assigneeId, { milestones: { some: { id } } }),
  ]);
  if (!milestone) return { ok: false, error: "Milestone not found." };
  if (resolved === undefined) return NOT_ASSIGNABLE;

  await prisma.milestone.update({ where: { id }, data: { assigneeId: resolved } });
  revalidatePath(`/admin/projects/${milestone.projectId}`);
  revalidatePath("/admin/my-work");
  return { ok: true };
}

/**
 * Delete a milestone that has no history; archive one that does. Logged hours
 * used to vanish with the milestone (the time entries cascade), and invoices
 * would lose the work they billed.
 */
export async function deleteMilestone(
  id: string,
): Promise<{ ok: true; archived: boolean } | { ok: false; error: string }> {
  await requireAdmin();
  const milestone = await prisma.milestone.findUnique({
    where: { id },
    select: { id: true, projectId: true, stage: true, archivedAt: true, sourceTaskRequestId: true },
  });
  if (!milestone) return { ok: false, error: "Milestone not found." };
  if (milestone.stage === "REQUESTED" && !milestone.archivedAt) {
    return { ok: false, error: "Decline the request instead — the client gets your note." };
  }

  const archived = await hasHistory(milestone);
  if (archived) {
    if (!milestone.archivedAt) await archiveTree(milestone.id);
  } else {
    await prisma.milestone.delete({ where: { id } });
  }
  revalidateProject(milestone.projectId);
  return { ok: true, archived };
}

/**
 * The list's drag: the plan's new order, every live item of the project in
 * it. No revalidatePath — the list and board are client state kept current by
 * their poll (the moved rows' updatedAt changes the version token), and a
 * revalidation would re-render the whole project page into every drag's
 * response.
 */
export async function reorderMilestones(
  projectId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  await requireTeam();

  // The list shows live items only; archived ones keep their old places.
  const milestones = await prisma.milestone.findMany({
    where: { projectId, archivedAt: null },
    select: { id: true, position: true },
  });
  const current = new Map(milestones.map((m) => [m.id, m.position]));
  if (
    orderedIds.length !== current.size ||
    !orderedIds.every((id) => current.has(id))
  ) {
    return { ok: false, error: "Milestone list is out of date — refresh the page." };
  }

  // One drag moves a handful of rows; only those are written.
  const changed = orderedIds
    .map((id, index) => ({ id, index }))
    .filter(({ id, index }) => current.get(id) !== index);
  if (changed.length) {
    await prisma.$transaction(
      changed.map(({ id, index }) =>
        prisma.milestone.update({ where: { id }, data: { position: index } }),
      ),
    );
  }
  return { ok: true };
}
