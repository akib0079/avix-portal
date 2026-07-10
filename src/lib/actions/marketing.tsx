"use server";

import { revalidatePath } from "next/cache";
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
  const eligible = await prisma.user.findMany({
    where: {
      id: { in: data.recipientIds },
      role: "CLIENT",
      status: "ACTIVE",
      marketingOptOut: false,
    },
    select: { id: true, email: true },
  });
  if (eligible.length === 0) {
    return { ok: false, error: "None of the selected clients can receive marketing email." };
  }

  const campaign = await prisma.campaign.create({
    data: {
      subject: data.subject,
      body: data.body as Prisma.InputJsonValue,
      templateId: data.templateId || null,
      status: "SENDING",
      recipients: { create: eligible.map((u) => ({ userId: u.id })) },
    },
  });

  // Sequential with pacing; per-recipient rows persist progress so a timeout
  // mid-send is recoverable from the campaign page via "Retry failed".
  for (const [index, recipient] of eligible.entries()) {
    if (index > 0) await sleep(SEND_DELAY_MS);
    await deliverTo(recipient, campaign);
  }
  await finalizeCampaignStatus(campaign.id);

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
