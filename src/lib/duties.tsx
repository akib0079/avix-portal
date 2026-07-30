import "server-only";
import { prisma } from "@/lib/prisma";
import { nextInvoiceNumber } from "@/lib/invoice-number";
import { notifyAllAdmins } from "@/lib/dal/notifications";
import { sendEmail } from "@/lib/email/resend";
import { appUrl } from "@/lib/app-url";
import { googleCalendarUrl, formatInTimezone } from "@/lib/calendar-links";
import { createMeetingIcsToken, createUnsubscribeToken } from "@/lib/marketing-token";
import MeetingScheduledEmail from "@/emails/meeting-scheduled";
import CampaignEmail from "@/emails/campaign";

/**
 * "Lazy cron": Hostinger has no background jobs, so scheduled work runs
 * piggybacked on admin page loads — runDueDuties() is called from the admin
 * layout, throttled to at most once per 15 minutes via an AppSetting stamp.
 * Everything here must be idempotent (stamps like reminderSentAt /
 * lastGeneratedPeriod make re-runs no-ops).
 */

const THROTTLE_KEY = "dutiesLastRunAt";
const THROTTLE_MS = 15 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deliver one campaign email and stamp the result on its recipient row, so a
 * crashed or timed-out run simply resumes from the rows that are still blank.
 */
async function deliverCampaignEmail(
  campaign: { id: string; subject: string; body: unknown },
  recipientRowId: string,
  userId: string,
  email: string,
): Promise<void> {
  const unsubscribeUrl = `${appUrl()}/unsubscribe?token=${createUnsubscribeToken(userId)}`;
  try {
    const result = await sendEmail({
      to: email,
      subject: campaign.subject,
      react: (
        <CampaignEmail
          subject={campaign.subject}
          body={campaign.body}
          unsubscribeUrl={unsubscribeUrl}
        />
      ),
      devHint: `campaign ${campaign.id} → ${email}`,
    });
    await prisma.campaignRecipient.update({
      where: { id: recipientRowId },
      data: result.ok
        ? { sentAt: new Date(), error: null }
        : { error: "Email provider rejected the send" },
    });
  } catch (err) {
    await prisma.campaignRecipient.update({
      where: { id: recipientRowId },
      data: { error: String(err instanceof Error ? err.message : err).slice(0, 500) },
    });
  }
}

function currentPeriod(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Meeting reminder: email the client ~24h before a scheduled meeting. */
async function sendMeetingReminders(now: Date) {
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const due = await prisma.meeting.findMany({
    where: {
      status: "SCHEDULED",
      reminderSentAt: null,
      startsAt: { gte: now, lte: windowEnd },
    },
    include: {
      client: {
        select: { id: true, firstName: true, email: true, status: true, timezone: true },
      },
    },
    take: 10,
  });

  for (const meeting of due) {
    // Stamp FIRST so a crash mid-send can't double-email later.
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { reminderSentAt: new Date() },
    });
    if (meeting.client.status !== "ACTIVE") continue;

    const whenText = formatInTimezone(meeting.startsAt, meeting.client.timezone);
    await prisma.notification.create({
      data: {
        userId: meeting.client.id,
        type: "MEETING_SCHEDULED",
        title: `Reminder: ${meeting.title}`,
        body: whenText,
        link: "/portal",
      },
    });
    await sendEmail({
      to: meeting.client.email,
      subject: `Reminder — ${meeting.title} (${whenText})`,
      react: (
        <MeetingScheduledEmail
          firstName={meeting.client.firstName || "there"}
          title={`Reminder: ${meeting.title}`}
          whenText={whenText}
          timezoneLabel={
            meeting.client.timezone
              ? `your time — ${meeting.client.timezone.split("/").pop()?.replaceAll("_", " ")}`
              : "UTC"
          }
          durationMins={meeting.durationMins}
          meetingUrl={meeting.meetingUrl}
          notes={meeting.notes}
          googleUrl={googleCalendarUrl(meeting)}
          icsUrl={`${appUrl()}/api/meetings/${meeting.id}/ics?token=${createMeetingIcsToken(meeting.id)}`}
        />
      ),
      devHint: `meeting reminder → ${meeting.client.email}`,
    });
  }
  return due.length;
}

/**
 * Retainers: once per month (on/after each retainer's dayOfMonth) draft an
 * ASSIGNED invoice for the admin to review and send — money never goes out
 * automatically.
 */
async function generateRetainerInvoices(now: Date) {
  const period = currentPeriod(now);
  const due = await prisma.retainer.findMany({
    where: {
      active: true,
      dayOfMonth: { lte: now.getDate() },
      OR: [{ lastGeneratedPeriod: null }, { lastGeneratedPeriod: { lt: period } }],
    },
    include: { client: { select: { id: true, firstName: true, lastName: true } } },
    take: 20,
  });

  let generated = 0;
  for (const retainer of due) {
    await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction (idempotency under races).
      const fresh = await tx.retainer.findUnique({ where: { id: retainer.id } });
      if (!fresh || !fresh.active || fresh.lastGeneratedPeriod === period) return;

      const invoiceNumber = await nextInvoiceNumber(tx);
      const monthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });
      await tx.invoice.create({
        data: {
          invoiceNumber,
          clientId: retainer.clientId,
          projectId: retainer.projectId,
          retainerId: retainer.id,
          amount: retainer.amount,
          status: "ASSIGNED",
          issueDate: now,
          dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
          title: `${retainer.title} — ${monthLabel}`,
          notes: `${retainer.title} — ${monthLabel}${retainer.notes ? `\n${retainer.notes}` : ""}`,
          // Line item so the generated PDF is complete without editing.
          items: {
            create: [
              {
                description: `${retainer.title} — ${monthLabel}`,
                qty: 1,
                rate: retainer.amount,
                sortOrder: 0,
              },
            ],
          },
        },
      });
      await tx.retainer.update({
        where: { id: retainer.id },
        data: { lastGeneratedPeriod: period },
      });
      generated++;
    });
  }

  if (generated > 0) {
    await notifyAllAdmins({
      type: "RETAINER_GENERATED",
      title: `${generated} retainer invoice${generated === 1 ? "" : "s"} drafted`,
      body: "Review and send them from Invoices.",
      link: "/admin/invoices",
    });
  }
  return generated;
}

/**
 * Campaigns: promote scheduled sends that are due, then drain a bounded batch
 * of pending recipients. Sending lives here rather than in the server action so
 * a large list can't blow the request timeout. Stamp-first (sentAt / error)
 * makes re-runs no-ops, exactly like reminderSentAt above.
 */
const CAMPAIGN_BATCH = 25;
const CAMPAIGN_SEND_DELAY_MS = 600; // Resend free tier allows 2 req/s

type DrainableCampaign = {
  id: string;
  subject: string;
  body: unknown;
  status: string;
};

/** One bounded batch for a single campaign. Returns rows still owing a send. */
async function runCampaignBatch(
  campaign: DrainableCampaign,
  now: Date,
): Promise<number> {
  const pending = await prisma.campaignRecipient.findMany({
    where: { campaignId: campaign.id, sentAt: null, error: null },
    take: CAMPAIGN_BATCH,
    include: { user: { select: { id: true, email: true, status: true, marketingOptOut: true } } },
  });

  if (pending.length === 0) {
    // Nothing left to try — settle the final status.
    const failed = await prisma.campaignRecipient.count({
      where: { campaignId: campaign.id, sentAt: null },
    });
    if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: failed === 0 ? { status: "SENT", sentAt: now } : { status: "FAILED" },
      });
    }
    return 0;
  }

  if (campaign.status !== "SENDING") {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "SENDING", startedAt: now },
    });
  }

  for (const [index, row] of pending.entries()) {
    if (index > 0) await sleep(CAMPAIGN_SEND_DELAY_MS);
    const user = row.user;
    // Someone may have opted out between composing and sending.
    if (!user || user.status !== "ACTIVE" || user.marketingOptOut) {
      await prisma.campaignRecipient.update({
        where: { id: row.id },
        data: { error: "Skipped — recipient opted out or is inactive" },
      });
      continue;
    }
    await deliverCampaignEmail(campaign, row.id, user.id, user.email);
  }

  return prisma.campaignRecipient.count({
    where: { campaignId: campaign.id, sentAt: null, error: null },
  });
}

/**
 * Drive one campaign's batch on demand (the "Send now" button polls this) so an
 * admin doesn't have to wait for the throttled duty run.
 */
export async function drainCampaignBatch(campaignId: string): Promise<number> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, subject: true, body: true, status: true },
  });
  if (!campaign) return 0;
  return runCampaignBatch(campaign, new Date());
}

async function drainCampaigns(now: Date): Promise<void> {
  // 1. Scheduled → queued once their moment arrives.
  await prisma.campaign.updateMany({
    where: { status: "SCHEDULED", scheduledAt: { not: null, lte: now } },
    data: { status: "QUEUED" },
  });

  // 2. Take the oldest campaign still owing emails.
  const campaign = await prisma.campaign.findFirst({
    where: { status: { in: ["QUEUED", "SENDING"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, subject: true, body: true, status: true },
  });
  if (!campaign) return;

  await runCampaignBatch(campaign, now);
}

/** Entry point — throttled, never throws (a duty failure must not 500 a page). */
export async function runDueDuties(): Promise<void> {
  try {
    const now = new Date();
    const stamp = await prisma.appSetting.findUnique({ where: { key: THROTTLE_KEY } });
    if (stamp && now.getTime() - Date.parse(stamp.value) < THROTTLE_MS) return;

    await prisma.appSetting.upsert({
      where: { key: THROTTLE_KEY },
      create: { key: THROTTLE_KEY, value: now.toISOString() },
      update: { value: now.toISOString() },
    });

    await sendMeetingReminders(now);
    await generateRetainerInvoices(now);
    await drainCampaigns(now);
  } catch (err) {
    console.error("[duties] run failed:", (err as Error).message);
  }
}
