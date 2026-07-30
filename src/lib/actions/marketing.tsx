"use server";

import { revalidatePath } from "next/cache";
import { drainCampaignBatch } from "@/lib/duties";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { sendEmail } from "@/lib/email/resend";
import { appUrl } from "@/lib/app-url";
import { createUnsubscribeToken } from "@/lib/marketing-token";
import CampaignEmail from "@/emails/campaign";
import {
  emailTemplateSchema,
  campaignSchema,
  type EmailTemplateInput,
  type CampaignInput,
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

const SEND_DELAY_MS = 600; // Resend free tier allows 2 req/s

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliverTo(
  recipient: { id: string; email: string },
  campaign: { id: string; subject: string; body: unknown },
): Promise<void> {
  const unsubscribeUrl = `${appUrl()}/unsubscribe?token=${createUnsubscribeToken(recipient.id)}`;
  try {
    const result = await sendEmail({
      to: recipient.email,
      subject: campaign.subject,
      react: (
        <CampaignEmail
          subject={campaign.subject}
          body={campaign.body}
          unsubscribeUrl={unsubscribeUrl}
        />
      ),
      devHint: `campaign ${campaign.id} → ${recipient.email}`,
    });
    await prisma.campaignRecipient.update({
      where: { campaignId_userId: { campaignId: campaign.id, userId: recipient.id } },
      data: result.ok
        ? { sentAt: new Date(), error: null }
        : { error: "Email provider rejected the send" },
    });
  } catch (err) {
    await prisma.campaignRecipient.update({
      where: { campaignId_userId: { campaignId: campaign.id, userId: recipient.id } },
      data: { error: String(err instanceof Error ? err.message : err).slice(0, 500) },
    });
  }
}

async function finalizeCampaignStatus(campaignId: string): Promise<void> {
  const failed = await prisma.campaignRecipient.count({
    where: { campaignId, sentAt: null },
  });
  await prisma.campaign.update({
    where: { id: campaignId },
    data: failed === 0 ? { status: "SENT", sentAt: new Date() } : { status: "FAILED" },
  });
}

/**
 * Resolve the eligible audience for a campaign. Never trusts the client list —
 * re-filters to ACTIVE clients who haven't opted out, which also covers races
 * with /unsubscribe between composing and sending.
 */
async function eligibleRecipients(recipientIds: string[]) {
  return prisma.user.findMany({
    where: {
      id: { in: recipientIds },
      role: "CLIENT",
      status: "ACTIVE",
      marketingOptOut: false,
    },
    select: { id: true, email: true },
  });
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
  const eligible = await eligibleRecipients(data.recipientIds);

  const campaign = await prisma.campaign.create({
    data: {
      subject: data.subject,
      body: data.body as Prisma.InputJsonValue,
      templateId: data.templateId || null,
      status: "DRAFT",
      recipients: { create: eligible.map((u) => ({ userId: u.id })) },
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
  const eligible = await eligibleRecipients(data.recipientIds);

  await prisma.$transaction([
    prisma.campaignRecipient.deleteMany({ where: { campaignId: id, sentAt: null } }),
    prisma.campaign.update({
      where: { id },
      data: {
        subject: data.subject,
        body: data.body as Prisma.InputJsonValue,
        templateId: data.templateId || null,
        recipients: { create: eligible.map((u) => ({ userId: u.id })) },
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
    include: { recipients: { select: { userId: true } } },
  });
  if (!source) return { ok: false, error: "Campaign not found." };

  const copy = await prisma.campaign.create({
    data: {
      subject: `${source.subject} (copy)`,
      body: source.body as Prisma.InputJsonValue,
      templateId: source.templateId,
      status: "DRAFT",
      recipients: {
        create: source.recipients
          .filter((r) => r.userId)
          .map((r) => ({ userId: r.userId })),
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

  // Never trust the client-side list: re-filter against eligible recipients
  // (ACTIVE clients who haven't opted out — covers races with /unsubscribe).
  const eligible = await eligibleRecipients(data.recipientIds);
  if (eligible.length === 0) {
    return { ok: false, error: "None of the selected clients can receive marketing email." };
  }

  // Queued, not sent inline: the duties engine drains it in bounded batches so
  // a big list can't blow the request timeout.
  const campaign = await prisma.campaign.create({
    data: {
      subject: data.subject,
      body: data.body as Prisma.InputJsonValue,
      templateId: data.templateId || null,
      status: "QUEUED",
      recipients: { create: eligible.map((u) => ({ userId: u.id })) },
    },
  });

  revalidatePath("/admin/marketing");
  revalidatePath(`/admin/marketing/${campaign.id}`);
  return { ok: true, data: { id: campaign.id } };
}

/** Re-send only the rows that failed or never got sent (e.g. after a timeout). */
export async function retryCampaignRecipients(
  campaignId: string,
): Promise<ActionResult> {
  await requireAdmin();
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      recipients: {
        where: { sentAt: null },
        include: { user: { select: { id: true, email: true, marketingOptOut: true, status: true } } },
      },
    },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.recipients.length === 0) {
    return { ok: false, error: "Nothing to retry — everyone received this campaign." };
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "SENDING" },
  });

  for (const [index, row] of campaign.recipients.entries()) {
    // Skip anyone who opted out or was deactivated since the original send.
    if (row.user.marketingOptOut || row.user.status !== "ACTIVE") {
      await prisma.campaignRecipient.update({
        where: { id: row.id },
        data: { error: "Skipped — recipient opted out or is inactive" },
      });
      continue;
    }
    if (index > 0) await sleep(SEND_DELAY_MS);
    await deliverTo(row.user, campaign);
  }
  await finalizeCampaignStatus(campaignId);

  revalidatePath("/admin/marketing");
  revalidatePath(`/admin/marketing/${campaignId}`);
  return { ok: true };
}
