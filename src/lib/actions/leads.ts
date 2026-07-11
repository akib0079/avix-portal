"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { createUserWithPassword, sendPasswordLink } from "@/lib/auth-utils";
import { leadSchema, type LeadInput } from "@/lib/validation/lead";
import type { LeadStage } from "@prisma/client";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalize(data: LeadInput) {
  return {
    name: data.name,
    email: data.email?.toLowerCase() || null,
    company: data.company || null,
    source: data.source,
    stage: data.stage,
    estimatedValue: data.estimatedValue ?? null,
    notes: data.notes || null,
    nextFollowUp: parseDate(data.nextFollowUp),
  };
}

export async function createLead(input: LeadInput): Promise<ActionResult> {
  await requireAdmin();
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  await prisma.lead.create({ data: normalize(parsed.data) });
  revalidatePath("/admin/leads");
  revalidatePath("/admin");
  return { ok: true };
}

export async function updateLead(id: string, input: LeadInput): Promise<ActionResult> {
  await requireAdmin();
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return { ok: false, error: "Lead not found." };

  await prisma.lead.update({ where: { id }, data: normalize(parsed.data) });
  revalidatePath("/admin/leads");
  revalidatePath("/admin");
  return { ok: true };
}

export async function setLeadStage(id: string, stage: LeadStage): Promise<ActionResult> {
  await requireAdmin();
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return { ok: false, error: "Lead not found." };

  await prisma.lead.update({ where: { id }, data: { stage } });
  revalidatePath("/admin/leads");
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteLead(id: string): Promise<ActionResult> {
  await requireAdmin();
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return { ok: false, error: "Lead not found." };

  await prisma.lead.delete({ where: { id } });
  revalidatePath("/admin/leads");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Won lead → client account: creates the CLIENT user (invite email so they
 * set their own password), marks the lead WON, and returns the client id so
 * the UI can jump straight into creating their first project.
 */
export async function convertLead(
  id: string,
): Promise<ActionResult<{ clientId: string }>> {
  await requireAdmin();
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return { ok: false, error: "Lead not found." };
  if (lead.convertedClientId) {
    return { ok: true, data: { clientId: lead.convertedClientId } };
  }
  if (!lead.email) {
    return { ok: false, error: "Add an email to this lead first — it becomes their login." };
  }

  const existing = await prisma.user.findUnique({
    where: { email: lead.email.toLowerCase() },
  });
  if (existing) {
    return { ok: false, error: "A user with this email already exists." };
  }

  const [firstName, ...rest] = lead.name.trim().split(/\s+/);
  const user = await createUserWithPassword({
    email: lead.email,
    password: randomBytes(24).toString("base64url"),
    firstName: firstName ?? lead.name,
    lastName: rest.join(" "),
    role: "CLIENT",
    company: lead.company,
    phone: null,
  });
  await sendPasswordLink(lead.email);

  await prisma.lead.update({
    where: { id },
    data: { stage: "WON", convertedClientId: user.id },
  });

  revalidatePath("/admin/leads");
  revalidatePath("/admin/clients");
  revalidatePath("/admin");
  return { ok: true, data: { clientId: user.id } };
}
