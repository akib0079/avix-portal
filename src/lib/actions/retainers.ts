"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { retainerSchema, type RetainerInput } from "@/lib/validation/retainer";

export type ActionResult = { ok: true } | { ok: false; error: string };

type NormalizeResult =
  | { error: string; values?: never }
  | {
      error?: never;
      values: {
        title: string;
        clientId: string;
        projectId: string | null;
        amount: number;
        dayOfMonth: number;
        active: boolean;
        notes: string | null;
      };
    };

async function normalize(data: RetainerInput): Promise<NormalizeResult> {
  const client = await prisma.user.findFirst({
    where: { id: data.clientId, role: "CLIENT" },
    select: { id: true },
  });
  if (!client) return { error: "Client not found." };

  let projectId: string | null = null;
  if (data.projectId !== "none") {
    const project = await prisma.project.findFirst({
      where: { id: data.projectId, clientId: client.id },
      select: { id: true },
    });
    if (!project) return { error: "Project not found for that client." };
    projectId = project.id;
  }

  return {
    values: {
      title: data.title,
      clientId: client.id,
      projectId,
      amount: data.amount,
      dayOfMonth: data.dayOfMonth,
      active: data.active,
      notes: data.notes || null,
    },
  };
}

export async function createRetainer(input: RetainerInput): Promise<ActionResult> {
  await requireAdmin();
  const parsed = retainerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const result = await normalize(parsed.data);
  if (result.error !== undefined) return { ok: false, error: result.error };

  await prisma.retainer.create({ data: result.values });
  revalidatePath("/admin/retainers");
  return { ok: true };
}

export async function updateRetainer(
  id: string,
  input: RetainerInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = retainerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const existing = await prisma.retainer.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Retainer not found." };

  const result = await normalize(parsed.data);
  if (result.error !== undefined) return { ok: false, error: result.error };

  await prisma.retainer.update({ where: { id }, data: result.values });
  revalidatePath("/admin/retainers");
  return { ok: true };
}

export async function deleteRetainer(id: string): Promise<ActionResult> {
  await requireAdmin();
  const existing = await prisma.retainer.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Retainer not found." };

  await prisma.retainer.delete({ where: { id } });
  revalidatePath("/admin/retainers");
  return { ok: true };
}
