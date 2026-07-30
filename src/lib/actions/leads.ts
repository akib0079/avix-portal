"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { createUserWithPassword, sendPasswordLink } from "@/lib/auth-utils";
import {
  leadSchema,
  leadEntrySchema,
  leadStageLabels,
  type LeadInput,
  type LeadEntryInput,
} from "@/lib/validation/lead";
import { logActivity } from "@/lib/dal/activity";
import type { LeadStage, Prisma } from "@prisma/client";

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
    brandInfo: data.brandInfo || null,
    responseMessage: data.responseMessage || null,
    nextFollowUp: parseDate(data.nextFollowUp),
    phone: data.phone || null,
    ownerId: data.ownerId && data.ownerId !== "none" ? data.ownerId : null,
    priority: data.priority,
    expectedCloseDate: parseDate(data.expectedCloseDate),
    tags: (data.tags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12),
  };
}

/** Appends one entry to a lead's contact log. Best-effort inside transactions. */
async function appendEntry(
  leadId: string,
  kind: "NOTE" | "CALL" | "EMAIL" | "MEETING" | "STAGE",
  body: string,
  authorId?: string | null,
) {
  await prisma.leadEntry.create({ data: { leadId, kind, body, authorId: authorId ?? null } });
}

/**
 * The shared tail of BOTH convert paths (convertLead here and runHandoff in
 * proposals): mark the lead won, remember the client, and record it once.
 */
export async function markLeadWon(
  tx: Prisma.TransactionClient,
  leadId: string,
  clientId: string,
) {
  await tx.lead.update({
    where: { id: leadId },
    data: { stage: "WON", convertedClientId: clientId },
  });
  await tx.leadEntry.create({
    data: { leadId, kind: "STAGE", body: "Converted to client — stage set to Won" },
  });
}

export async function createLead(input: LeadInput): Promise<ActionResult> {
  await requireAdmin();
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const lead = await prisma.lead.create({ data: normalize(parsed.data) });
  await logActivity({
    type: "lead.created",
    summary: `Lead added: ${lead.name}${lead.company ? ` (${lead.company})` : ""}`,
    entity: "lead",
    entityId: lead.id,
    link: `/admin/leads/${lead.id}`,
  });
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

export async function setLeadStage(
  id: string,
  stage: LeadStage,
  lostReason?: string,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return { ok: false, error: "Lead not found." };
  if (lead.stage === stage) return { ok: true };

  // Losing a lead without saying why makes the pipeline unlearnable.
  const reason = lostReason?.trim().slice(0, 1000) || null;
  if (stage === "LOST" && !reason) {
    return { ok: false, error: "Add a reason so we know why this one was lost." };
  }

  await prisma.lead.update({
    where: { id },
    data: { stage, ...(stage === "LOST" ? { lostReason: reason } : {}) },
  });
  await appendEntry(
    id,
    "STAGE",
    `${leadStageLabels[lead.stage]} → ${leadStageLabels[stage]}` +
      (stage === "LOST" && reason ? ` · ${reason}` : ""),
    session.id,
  );
  await logActivity({
    type: stage === "WON" ? "lead.won" : "lead.stage",
    summary: `${lead.name}: ${leadStageLabels[lead.stage]} → ${leadStageLabels[stage]}`,
    actorId: session.id,
    entity: "lead",
    entityId: id,
    link: `/admin/leads/${id}`,
  });

  revalidatePath("/admin/leads");
  revalidatePath(`/admin/leads/${id}`);
  revalidatePath("/admin");
  return { ok: true };
}

/** Adds a note/call/email/meeting to the contact log. */
export async function addLeadEntry(
  leadId: string,
  input: LeadEntryInput,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = leadEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) return { ok: false, error: "Lead not found." };

  await appendEntry(leadId, parsed.data.kind, parsed.data.body, session.id);
  revalidatePath(`/admin/leads/${leadId}`);
  return { ok: true };
}

export async function deleteLeadEntry(id: string): Promise<ActionResult> {
  await requireAdmin();
  const entry = await prisma.leadEntry.findUnique({
    where: { id },
    select: { id: true, leadId: true },
  });
  if (!entry) return { ok: false, error: "Entry not found." };

  await prisma.leadEntry.delete({ where: { id } });
  revalidatePath(`/admin/leads/${entry.leadId}`);
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

/** Minimal RFC-4180-ish CSV parser (handles quotes, commas, newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const SOURCE_LOOKUP: Record<string, string> = {
  fiverr: "FIVERR",
  upwork: "UPWORK",
  referral: "REFERRAL",
  website: "WEBSITE",
  other: "OTHER",
};
const STAGE_LOOKUP: Record<string, string> = {
  new: "NEW",
  contacted: "CONTACTED",
  proposal: "PROPOSAL",
  "proposal sent": "PROPOSAL",
  won: "WON",
  lost: "LOST",
};

/**
 * Bulk-import leads from CSV text (Excel: Save As .csv). Expected header
 * columns (case-insensitive, order-independent): name, email, company,
 * source, stage, estimatedValue, notes, nextFollowUp. Only `name` required.
 * Skips invalid rows and reports counts.
 */
export async function importLeads(
  csvText: string,
): Promise<ActionResult<{ imported: number; skipped: number; errors: string[] }>> {
  await requireAdmin();
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return { ok: false, error: "The file has no data rows below the header." };
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const idx = {
    name: col("name"),
    email: col("email"),
    company: col("company"),
    source: col("source"),
    stage: col("stage"),
    value: header.findIndex((h) => h === "estimatedvalue" || h === "value" || h === "est. value"),
    notes: col("notes"),
    brandInfo: header.findIndex((h) => h === "brandinfo" || h === "brand info"),
    responseMessage: header.findIndex(
      (h) => h === "responsemessage" || h === "response message" || h === "response",
    ),
    followUp: header.findIndex((h) => h === "nextfollowup" || h === "follow up" || h === "followup"),
  };
  if (idx.name === -1) {
    return { ok: false, error: 'CSV must have a "name" column.' };
  }

  const cell = (row: string[], i: number) => (i === -1 ? "" : (row[i] ?? "").trim());
  const toCreate: {
    name: string;
    email: string | null;
    company: string | null;
    source: string;
    stage: string;
    estimatedValue: number | null;
    notes: string | null;
    brandInfo: string | null;
    responseMessage: string | null;
    nextFollowUp: Date | null;
  }[] = [];
  const errors: string[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = cell(row, idx.name);
    if (!name) {
      errors.push(`Row ${r + 1}: missing name`);
      continue;
    }
    const rawValue = cell(row, idx.value).replace(/[$,]/g, "");
    const value = rawValue ? Number(rawValue) : null;
    const followRaw = cell(row, idx.followUp);
    const follow = followRaw ? new Date(followRaw) : null;
    toCreate.push({
      name: name.slice(0, 160),
      email: cell(row, idx.email).toLowerCase() || null,
      company: cell(row, idx.company) || null,
      source: SOURCE_LOOKUP[cell(row, idx.source).toLowerCase()] ?? "OTHER",
      stage: STAGE_LOOKUP[cell(row, idx.stage).toLowerCase()] ?? "NEW",
      estimatedValue: value != null && !Number.isNaN(value) ? value : null,
      notes: cell(row, idx.notes) || null,
      brandInfo: cell(row, idx.brandInfo) || null,
      responseMessage: cell(row, idx.responseMessage) || null,
      nextFollowUp: follow && !Number.isNaN(follow.getTime()) ? follow : null,
    });
  }

  if (toCreate.length === 0) {
    return { ok: false, error: "No valid rows found. " + errors.slice(0, 3).join("; ") };
  }

  await prisma.lead.createMany({
    data: toCreate as never,
  });

  revalidatePath("/admin/leads");
  revalidatePath("/admin");
  return {
    ok: true,
    data: { imported: toCreate.length, skipped: errors.length, errors: errors.slice(0, 5) },
  };
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
    phone: lead.phone,
  });
  await sendPasswordLink(lead.email);

  await prisma.$transaction((tx) => markLeadWon(tx, id, user.id));
  await logActivity({
    type: "lead.won",
    summary: `${lead.name} converted to a client`,
    clientId: user.id,
    entity: "lead",
    entityId: id,
    link: `/admin/leads/${id}`,
  });

  revalidatePath("/admin/leads");
  revalidatePath(`/admin/leads/${id}`);
  revalidatePath("/admin/clients");
  revalidatePath("/admin");
  return { ok: true, data: { clientId: user.id } };
}
