"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { projectSchema, type ProjectInput } from "@/lib/validation/project";
import { milestoneTemplates, textToDoc } from "@/lib/milestone-templates";
import type { Prisma } from "@prisma/client";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
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
      description: (data.description as Prisma.InputJsonValue) ?? undefined,
      startDate: parseDate(data.startDate),
      dueDate: parseDate(data.dueDate),
      milestones: {
        create: template.map((m, index) => ({
          title: m.title,
          description: textToDoc(m.description),
          position: index,
        })),
      },
    },
  });

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
      description: (data.description as Prisma.InputJsonValue) ?? undefined,
      startDate: parseDate(data.startDate),
      dueDate: parseDate(data.dueDate),
    },
  });

  revalidatePath("/admin/projects");
  revalidatePath(`/admin/projects/${id}`);
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
