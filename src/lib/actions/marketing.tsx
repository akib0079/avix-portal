"use server";

import { revalidatePath } from "next/cache";
import { drainCampaignBatch } from "@/lib/duties";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { sendEmail } from "@/lib/email/resend";
import { appUrl } from "@/lib/app-url";
import { renderMergeTags, renderMergeTagsInDoc } from "@/lib/merge-tags";
import CampaignEmail from "@/emails/campaign";
import {
  emailTemplateSchema,
  campaignSchema,
  segmentSchema,
  type EmailTemplateInput,
  type CampaignInput,
  type SegmentInput,
} from "@/lib/validation/marketing";
import type { Prisma } from "@prisma/client";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

// ---------- Templates ----------

export async function createTemplate(
  input: EmailTemplateInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = emailTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  await prisma.emailTemplate.create({
    data: {
      name: parsed.data.name,
      subject: parsed.data.subject,
      body: parsed.data.body as Prisma.InputJsonValue,
    },
  });
  revalidatePath("/admin/marketing/templates");
  return { ok: true };
}

export async function updateTemplate(
  id: string,
  input: EmailTemplateInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = emailTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const template = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!template) return { ok: false, error: "Template not found." };

  await prisma.emailTemplate.update({
    where: { id },
    data: {
      name: parsed.data.name,
      subject: parsed.data.subject,
      body: parsed.data.body as Prisma.InputJsonValue,
    },
  });
  revalidatePath("/admin/marketing/templates");
  return { ok: true };
}

export async function deleteTemplate(id: string): Promise<ActionResult> {
  await requireAdmin();
  const template = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!template) return { ok: false, error: "Template not found." };

  await prisma.emailTemplate.delete({ where: { id } });
  revalidatePath("/admin/marketing/templates");
  return { ok: true };
}

// ---------- Campaigns ----------

/**
 * Mail the signed-in admin a copy with sample merge values, so the real thing
 * can be checked in a real inbox before anyone else gets it.
 */
export async function sendTestCampaign(input: CampaignInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = campaignSchema.safeParse({ ...input, recipientIds: ["self"] });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const vars = {
    firstName: admin.firstName || "Alex",
    name: `${admin.firstName ?? ""} ${admin.lastName ?? ""}`.trim() || "Alex Morgan",
    company: "Northwind Studio",
    email: admin.email,
  };
  const subject = `[Test] ${renderMergeTags(parsed.data.subject, vars)}`;
  const body = renderMergeTagsInDoc(parsed.data.body, vars);

  const result = await sendEmail({
    to: admin.email,
    subject,
    react: (
      <CampaignEmail
        subject={subject}
        body={body}
        unsubscribeUrl={`${appUrl()}/unsubscribe?token=test`}
      />
    ),
    devHint: `campaign test → ${admin.email}`,
  });
  if (!result.ok) return { ok: false, error: "The email provider rejected the test send." };
  return { ok: true };
}

// ---------- Audience segments ----------

/** Save the composer's current filters so a recurring send is one click. */
export async function saveSegment(input: SegmentInput): Promise<ActionResult> {
  await requireAdmin();
  const parsed = segmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  await prisma.audienceSegment.create({
    data: {
      name: parsed.data.name,
      filter: parsed.data.filter as Prisma.InputJsonValue,
    },
  });
  revalidatePath("/admin/marketing");
  return { ok: true };
}

export async function deleteSegment(id: string): Promise<ActionResult> {
  await requireAdmin();
  await prisma.audienceSegment.delete({ where: { id } });
  revalidatePath("/admin/marketing");
  return { ok: true };
}

// ---------- Campaigns ----------

/**
 * Turn the composer's "client:<id>" / "lead:<id>" keys into recipient rows.
 * Never trusts the submitted list — it re-resolves against the mailable
 * audience, which also covers races with /unsubscribe between composing and
 * sending. The address and merge values are snapshotted onto the row.
 */
async function resolveRecipientRows(
  keys: string[],
): Promise<Prisma.CampaignRecipientCreateWithoutCampaignInput[]> {
  const clientIds: string[] = [];
  const leadIds: string[] = [];
  for (const key of keys) {
    // Bare ids are legacy client ids from before leads could be mailed.
    if (key.startsWith("lead:")) leadIds.push(key.slice(5));
    else clientIds.push(key.startsWith("client:") ? key.slice(7) : key);
  }

  const [clients, leads] = await Promise.all([
    clientIds.length
      ? prisma.user.findMany({
          where: {
            id: { in: clientIds },
            role: "CLIENT",
            status: "ACTIVE",
            marketingOptOut: false,
          },
          select: { id: true, email: true, firstName: true, company: true },
        })
      : Promise.resolve([]),
    leadIds.length
      ? prisma.lead.findMany({
          where: { id: { in: leadIds }, email: { not: null }, marketingOptOut: false },
          select: { id: true, email: true, name: true, company: true },
        })
      : Promise.resolve([]),
  ]);

  const rows: Prisma.CampaignRecipientCreateWithoutCampaignInput[] = [];
  const seen = new Set<string>();
  for (const c of clients) {
    if (seen.has(c.email.toLowerCase())) continue;
    seen.add(c.email.toLowerCase());
    rows.push({
      user: { connect: { id: c.id } },
      email: c.email,
      firstName: c.firstName,
      company: c.company,
    });
  }
  for (const l of leads) {
    const email = l.email!;
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    rows.push({
      lead: { connect: { id: l.id } },
      email,
      firstName: l.name.split(" ")[0] ?? l.name,
      company: l.company,
    });
  }
  return rows;
}

/** Save a campaign without sending it. Editable until it is queued. */
export async function saveCampaignDraft(
  input: CampaignInput,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const rows = await resolveRecipientRows(data.recipientIds);

  const campaign = await prisma.campaign.create({
    data: {
      subject: data.subject,
      body: data.body as Prisma.InputJsonValue,
      templateId: data.templateId || null,
      status: "DRAFT",
      recipients: { create: rows },
    },
  });

  revalidatePath("/admin/marketing");
  return { ok: true, data: { id: campaign.id } };
}

/** Edit a campaign that hasn't started sending yet. */
export async function updateCampaign(
  id: string,
  input: CampaignInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const existing = await prisma.campaign.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) return { ok: false, error: "Campaign not found." };
  if (existing.status !== "DRAFT" && existing.status !== "SCHEDULED") {
    return { ok: false, error: "Only drafts and scheduled campaigns can be edited." };
  }

  const data = parsed.data;
  const rows = await resolveRecipientRows(data.recipientIds);

  await prisma.$transaction([
    prisma.campaignRecipient.deleteMany({ where: { campaignId: id, sentAt: null } }),
    prisma.campaign.update({
      where: { id },
      data: {
        subject: data.subject,
        body: data.body as Prisma.InputJsonValue,
        templateId: data.templateId || null,
        recipients: { create: rows },
      },
    }),
  ]);

  revalidatePath("/admin/marketing");
  revalidatePath(`/admin/marketing/${id}`);
  return { ok: true };
}

/**
 * Hand a campaign to the duties engine. Sending deliberately does NOT happen
 * here — a sequential send inside the request times out on large lists.
 */
export async function queueCampaign(id: string): Promise<ActionResult> {
  await requireAdmin();
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: { id: true, status: true, _count: { select: { recipients: true } } },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.status === "SENT" || campaign.status === "SENDING") {
    return { ok: false, error: "This campaign is already on its way." };
  }
  if (campaign._count.recipients === 0) {
    return { ok: false, error: "Add at least one recipient first." };
  }

  await prisma.campaign.update({
    where: { id },
    data: { status: "QUEUED", scheduledAt: null },
  });
  revalidatePath("/admin/marketing");
  revalidatePath(`/admin/marketing/${id}`);
  return { ok: true };
}

/** Schedule a campaign for later; the duties engine promotes it when due. */
export async function scheduleCampaign(
  id: string,
  whenIso: string,
): Promise<ActionResult> {
  await requireAdmin();
  const when = new Date(whenIso);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Pick a valid date and time." };
  if (when.getTime() < Date.now()) return { ok: false, error: "Pick a time in the future." };

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: { status: true, _count: { select: { recipients: true } } },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
    return { ok: false, error: "Only drafts can be scheduled." };
  }
  if (campaign._count.recipients === 0) {
    return { ok: false, error: "Add at least one recipient first." };
  }

  await prisma.campaign.update({
    where: { id },
    data: { status: "SCHEDULED", scheduledAt: when },
  });
  revalidatePath("/admin/marketing");
  revalidatePath(`/admin/marketing/${id}`);
  return { ok: true };
}

/**
 * Push one bounded batch for a campaign that is already queued. The detail page
 * calls this in a loop so "Send now" shows live progress instead of waiting for
 * the throttled duty run (which only fires on admin page loads).
 */
export async function pushCampaignBatch(
  id: string,
): Promise<ActionResult<{ remaining: number }>> {
  await requireAdmin();
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.status === "DRAFT" || campaign.status === "SCHEDULED") {
    return { ok: false, error: "Queue this campaign before sending." };
  }

  const remaining = await drainCampaignBatch(id);
  revalidatePath("/admin/marketing");
  revalidatePath(`/admin/marketing/${id}`);
  return { ok: true, data: { remaining } };
}

/** Copy a campaign back into an editable draft. */
export async function duplicateCampaign(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const source = await prisma.campaign.findUnique({
    where: { id },
    include: {
      recipients: {
        select: { userId: true, leadId: true, email: true, firstName: true, company: true },
      },
    },
  });
  if (!source) return { ok: false, error: "Campaign not found." };

  const copy = await prisma.campaign.create({
    data: {
      subject: `${source.subject} (copy)`,
      body: source.body as Prisma.InputJsonValue,
      templateId: source.templateId,
      status: "DRAFT",
      recipients: {
        create: source.recipients.map((r) => ({
          userId: r.userId,
          leadId: r.leadId,
          email: r.email,
          firstName: r.firstName,
          company: r.company,
        })),
      },
    },
  });

  revalidatePath("/admin/marketing");
  return { ok: true, data: { id: copy.id } };
}

export async function sendCampaign(
  input: CampaignInput,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const rows = await resolveRecipientRows(data.recipientIds);
  if (rows.length === 0) {
    return { ok: false, error: "None of the selected people can receive marketing email." };
  }

  // Queued, not sent inline: the duties engine drains it in bounded batches so
  // a big list can't blow the request timeout.
  const campaign = await prisma.campaign.create({
    data: {
      subject: data.subject,
      body: data.body as Prisma.InputJsonValue,
      templateId: data.templateId || null,
      status: "QUEUED",
      recipients: { create: rows },
    },
  });

  revalidatePath("/admin/marketing");
  revalidatePath(`/admin/marketing/${campaign.id}`);
  return { ok: true, data: { id: campaign.id } };
}

/**
 * Re-send only the rows that failed. Clearing the error puts them back in the
 * drain's pending set — the send itself still happens in bounded batches.
 */
export async function retryCampaignRecipients(
  campaignId: string,
): Promise<ActionResult> {
  await requireAdmin();
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, _count: { select: { recipients: { where: { sentAt: null } } } } },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign._count.recipients === 0) {
    return { ok: false, error: "Nothing to retry — everyone received this campaign." };
  }

  await prisma.$transaction([
    prisma.campaignRecipient.updateMany({
      where: { campaignId, sentAt: null },
      data: { error: null },
    }),
    prisma.campaign.update({ where: { id: campaignId }, data: { status: "QUEUED" } }),
  ]);

  revalidatePath("/admin/marketing");
  revalidatePath(`/admin/marketing/${campaignId}`);
  return { ok: true };
}
