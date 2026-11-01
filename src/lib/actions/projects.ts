"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { projectSchema, type ProjectInput } from "@/lib/validation/project";
import { milestoneTemplates, textToDoc } from "@/lib/milestone-templates";
import { sendProjectCreatedEmail } from "@/lib/email/project-emails";
import { projectTypeLabels } from "@/lib/format";
import { POSITION_STEP, parseDay } from "@/lib/board";
import { stageWrite } from "@/lib/work-stage";
import type { Prisma, Priority, ProjectStatus } from "@prisma/client";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/** Calendar days are stored as UTC midnight everywhere (see parseDay). */
function parseDate(value: string | undefined): Date | null {
  return parseDay(value) ?? null;
}

async function resolveClientId(clientId: string): Promise<string | null | undefined> {
  if (clientId === "none") return null;
  const client = await prisma.user.findFirst({
    where: { id: clientId, role: "CLIENT" },
    select: { id: true },
  });
  return client ? client.id : undefined; // undefined = invalid input
}

export async function createProject(
  input: ProjectInput,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const clientId = await resolveClientId(data.clientId);
  if (clientId === undefined) return { ok: false, error: "Selected client not found." };

  const template = milestoneTemplates[data.type];
  const project = await prisma.project.create({
    data: {
      projectName: data.projectName,
      clientId,
      type: data.type,
      source: data.source,
      priority: data.priority,
      status: data.status,
      billingType: data.billingType,
      contractPrice: data.billingType === "CONTRACT" ? data.contractPrice : null,
      description: (data.description as Prisma.InputJsonValue) ?? undefined,
      startDate: parseDate(data.startDate),
      dueDate: parseDate(data.dueDate),
      milestones: {
        create: template.map((m, index) => ({
          title: m.title,
          description: textToDoc(m.description),
          ...stageWrite("TODO"),
          position: index,
          boardPosition: (index + 1) * POSITION_STEP,
          createdByRole: "ADMIN" as const,
        })),
      },
    },
  });

  // Send exactly ONE email to the client when their project is created.
  // Milestones (auto-populated + later edits) intentionally do NOT email —
  // they surface only via the in-app notification bell to avoid inbox spam.
  if (clientId) {
    const client = await prisma.user.findUnique({
      where: { id: clientId },
      select: { email: true, firstName: true, status: true },
    });
    if (client && client.status === "ACTIVE") {
      await sendProjectCreatedEmail({
        to: client.email,
        firstName: client.firstName,
        projectName: project.projectName,
        projectType: projectTypeLabels[project.type],
        projectId: project.id,
      });
    }
  }

  revalidatePath("/admin/projects");
  revalidatePath("/admin");
  return { ok: true, data: { id: project.id } };
}

export async function updateProject(
  id: string,
  input: ProjectInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return { ok: false, error: "Project not found." };

  const clientId = await resolveClientId(data.clientId);
  if (clientId === undefined) return { ok: false, error: "Selected client not found." };

  await prisma.project.update({
    where: { id },
    data: {
      projectName: data.projectName,
      clientId,
      type: data.type,
      source: data.source,
      priority: data.priority,
      status: data.status,
      billingType: data.billingType,
      contractPrice: data.billingType === "CONTRACT" ? data.contractPrice : null,
      description: (data.description as Prisma.InputJsonValue) ?? undefined,
      startDate: parseDate(data.startDate),
      dueDate: parseDate(data.dueDate),
    },
  });

  revalidatePath("/admin/projects");
  revalidatePath(`/admin/projects/${id}`);
  return { ok: true };
}

/**
 * Inline status / priority changes from the project rail. Separate from
 * updateProject so a one-field change doesn't have to round-trip the whole
 * form (and can't accidentally blank a field the rail doesn't show).
 */
export async function setProjectStatus(
  id: string,
  status: ProjectStatus,
): Promise<ActionResult> {
  await requireAdmin();
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) return { ok: false, error: "Project not found." };

  await prisma.project.update({ where: { id }, data: { status } });
  revalidatePath("/admin/projects");
  revalidatePath(`/admin/projects/${id}`);
  revalidatePath(`/portal/projects/${id}`);
  return { ok: true };
}

export async function setProjectPriority(
  id: string,
  priority: Priority,
): Promise<ActionResult> {
  await requireAdmin();
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) return { ok: false, error: "Project not found." };

  await prisma.project.update({ where: { id }, data: { priority } });
  revalidatePath("/admin/projects");
  revalidatePath(`/admin/projects/${id}`);
  return { ok: true };
}

/**
 * Whether the client's additions skip the Requested column and land in To
 * do, unpriced — for contract and retainer projects where small asks are in
 * scope. Admin-only: it decides whether work gets priced before it starts.
 */
export async function setAutoAcceptClientTasks(
  id: string,
  enabled: boolean,
): Promise<ActionResult> {
  await requireAdmin();
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) return { ok: false, error: "Project not found." };

  await prisma.project.update({ where: { id }, data: { autoAcceptClientTasks: enabled } });
  revalidatePath(`/admin/projects/${id}`);
  return { ok: true };
}

/** Who on the team is accountable for this project. */
export async function setProjectOwner(
  id: string,
  ownerId: string | null,
): Promise<ActionResult> {
  await requireAdmin();
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) return { ok: false, error: "Project not found." };

  let resolved: string | null = null;
  if (ownerId && ownerId !== "none") {
    const user = await prisma.user.findFirst({
      where: { id: ownerId, role: { in: ["ADMIN", "STAFF"] } },
      select: { id: true },
    });
    if (!user) return { ok: false, error: "That team member no longer exists." };
    resolved = user.id;
  }

  await prisma.project.update({ where: { id }, data: { ownerId: resolved } });
  revalidatePath("/admin/projects");
  revalidatePath(`/admin/projects/${id}`);
  revalidatePath("/admin/my-work");
  return { ok: true };
}

export async function deleteProject(id: string): Promise<ActionResult> {
  await requireAdmin();
  const project = await prisma.project.findUnique({
    where: { id },
    include: { _count: { select: { invoices: true } } },
  });
  if (!project) return { ok: false, error: "Project not found." };

  await prisma.project.delete({ where: { id } });

  revalidatePath("/admin/projects");
  revalidatePath("/admin");
  return { ok: true };
}
