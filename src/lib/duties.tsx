import "server-only";
import { prisma } from "@/lib/prisma";
import { nextInvoiceNumber } from "@/lib/invoice-number";
import { notifyAllAdmins } from "@/lib/dal/notifications";
import { sendEmail } from "@/lib/email/resend";
import { appUrl } from "@/lib/app-url";
import { formatMoney } from "@/lib/format";
import { googleCalendarUrl, formatInTimezone } from "@/lib/calendar-links";
import {
  createMeetingIcsToken,
  createUnsubscribeToken,
  createLeadUnsubscribeToken,
} from "@/lib/marketing-token";
import MeetingScheduledEmail from "@/emails/meeting-scheduled";
import CampaignEmail from "@/emails/campaign";
import InvoiceReminderEmail from "@/emails/invoice-reminder";
import { renderMergeTags, renderMergeTagsInDoc } from "@/lib/merge-tags";

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
  recipient: {
    id: string;
    email: string;
    userId: string | null;
    leadId: string | null;
    firstName?: string | null;
    company?: string | null;
    name?: string | null;
  },
): Promise<void> {
  const recipientRowId = recipient.id;
  const email = recipient.email;
  // Personalise per recipient — fallbacks in renderMergeTags keep "Hi there"
  // rather than "Hi ," when a value is missing.
  const vars = {
    firstName: recipient.firstName,
    name: recipient.name ?? recipient.firstName,
    company: recipient.company,
    email,
  };
  const subject = renderMergeTags(campaign.subject, vars);
  const body = renderMergeTagsInDoc(campaign.body, vars);
  const token = recipient.userId
    ? createUnsubscribeToken(recipient.userId)
    : createLeadUnsubscribeToken(recipient.leadId ?? "");
  const unsubscribeUrl = `${appUrl()}/unsubscribe?token=${token}`;
  try {
    const result = await sendEmail({
      to: email,
      subject,
      react: (
        <CampaignEmail subject={subject} body={body} unsubscribeUrl={unsubscribeUrl} />
      ),
      // One-click unsubscribe for the recipient's mail client (RFC 8058). The
      // header points at the POST endpoint; the visible link goes to the
      // confirm page.
      headers: {
        "List-Unsubscribe": `<${appUrl()}/api/unsubscribe?token=${token}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
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
    include: {
      user: { select: { id: true, email: true, status: true, marketingOptOut: true } },
      lead: { select: { id: true, name: true, email: true, marketingOptOut: true } },
    },
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
    // Someone may have opted out between composing and sending. The snapshot
    // on the row is what we mail; the source record is only consulted for
    // permission.
    const optedOut = row.user
      ? row.user.status !== "ACTIVE" || row.user.marketingOptOut
      : row.lead
        ? row.lead.marketingOptOut
        : false;
    const email = row.email ?? row.user?.email ?? row.lead?.email ?? null;
    if (optedOut || !email) {
      await prisma.campaignRecipient.update({
        where: { id: row.id },
        data: {
          error: email
            ? "Skipped — recipient opted out or is inactive"
            : "Skipped — no email address on file",
        },
      });
      continue;
    }
    await deliverCampaignEmail(campaign, {
      id: row.id,
      email,
      userId: row.userId,
      leadId: row.leadId,
      firstName: row.firstName,
      company: row.company,
      name: row.lead?.name ?? row.firstName,
    });
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

/**
 * Chase overdue invoices. One reminder per invoice per REMINDER_GAP_DAYS, and
 * only for documents that were actually sent and still owe money — stamp-first
 * on lastReminderAt so a re-run can't double-send.
 */
const REMINDER_GAP_DAYS = 7;
const REMINDER_BATCH = 10;

async function chaseOverdueInvoices(now: Date): Promise<void> {
  const gapAgo = new Date(now.getTime() - REMINDER_GAP_DAYS * 24 * 60 * 60 * 1000);

  const overdue = await prisma.invoice.findMany({
    where: {
      status: { in: ["SENT", "IN_REVIEW", "PARTIALLY_PAID"] },
      dueDate: { not: null, lt: now },
      OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: gapAgo } }],
    },
    take: REMINDER_BATCH,
    include: {
      client: { select: { id: true, firstName: true, email: true, status: true } },
    },
  });

  for (const invoice of overdue) {
    const balance = Number(invoice.amount) - Number(invoice.amountPaid);
    if (balance <= 0 || invoice.client.status !== "ACTIVE") {
      // Nothing owing (or nobody to tell) — stamp so it stops being picked up.
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { lastReminderAt: now },
      });
      continue;
    }

    // Stamp first: a send that fails should not retry on every page load.
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { lastReminderAt: now },
    });

    const daysOverdue = Math.max(
      1,
      Math.floor((now.getTime() - invoice.dueDate!.getTime()) / 86_400_000),
    );

    await sendEmail({
      to: invoice.client.email,
      subject: `Reminder: invoice ${invoice.invoiceNumber} is overdue`,
      react: (
        <InvoiceReminderEmail
          firstName={invoice.client.firstName || "there"}
          invoiceNumber={invoice.invoiceNumber}
          amount={formatMoney(balance, invoice.currency)}
          dueDate={invoice.dueDate!.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          daysOverdue={daysOverdue}
          portalUrl={`${appUrl()}/portal/invoices/${invoice.id}`}
        />
      ),
      devHint: `invoice reminder → ${invoice.client.email}`,
    });

    await prisma.notification.create({
      data: {
        userId: invoice.client.id,
        type: "INVOICE_SENT",
        title: `Invoice ${invoice.invoiceNumber} is overdue`,
        body: `${formatMoney(balance, invoice.currency)} was due ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} ago`,
        link: `/portal/invoices/${invoice.id}`,
      },
    });
  }
}

/** Entry point — throttled, never throws (a duty failure must not 500 a page). */
/**
 * Turns things the app already knows into to-dos.
 *
 * The portal has always been able to tell you an invoice is 14 days late, a
 * lead has sat unanswered since Tuesday, a proposal expires on Friday. Until
 * now it could only email about it, which means the reminder lives in an inbox
 * you have already archived. These become real tasks you can tick, snooze or
 * reassign.
 *
 * Every task carries a systemKey unique per source row, and the column is
 * @unique, so this is safe to run on the 15-minute cadence: the second run
 * finds the existing task instead of adding a duplicate. A task the user
 * deleted stays deleted only until the underlying condition changes — which is
 * the correct behaviour for "this invoice is still unpaid".
 */
async function generateSystemTasks(now: Date): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  if (!owner) return;

  type Seed = {
    systemKey: string;
    title: string;
    priority: "HIGH" | "MEDIUM" | "LOW";
    dueDate: Date;
    clientId?: string | null;
    projectId?: string | null;
    invoiceId?: string | null;
    leadId?: string | null;
  };
  const seeds: Seed[] = [];

  // Invoices past their due date and still unpaid.
  const overdue = await prisma.invoice.findMany({
    // Same status set the email chaser uses, so the task and the chase email
    // never disagree about which invoices are actually outstanding.
    where: {
      status: { in: ["SENT", "IN_REVIEW", "PARTIALLY_PAID"] },
      dueDate: { not: null, lt: now },
    },
    select: { id: true, invoiceNumber: true, clientId: true, dueDate: true, amount: true },
    take: 50,
  });
  for (const inv of overdue) {
    seeds.push({
      systemKey: `invoice-overdue:${inv.id}`,
      title: `Chase payment on ${inv.invoiceNumber}`,
      priority: "HIGH",
      dueDate: now,
      clientId: inv.clientId,
      invoiceId: inv.id,
    });
  }

  // Leads with a follow-up date that has arrived, and no reply logged.
  const dueLeads = await prisma.lead.findMany({
    where: {
      stage: { notIn: ["WON", "LOST"] },
      nextFollowUp: { lte: now },
    },
    select: { id: true, name: true, nextFollowUp: true },
    take: 50,
  });
  for (const lead of dueLeads) {
    seeds.push({
      systemKey: `lead-followup:${lead.id}:${lead.nextFollowUp?.toISOString().slice(0, 10)}`,
      title: `Follow up with ${lead.name}`,
      priority: "HIGH",
      dueDate: lead.nextFollowUp ?? now,
      leadId: lead.id,
    });
  }

  // Meetings inside the next 24h — a prep task, due before the call.
  const soon = new Date(now.getTime() + 24 * 60 * 60_000);
  const meetings = await prisma.meeting.findMany({
    where: { status: "SCHEDULED", startsAt: { gte: now, lte: soon } },
    select: { id: true, title: true, startsAt: true, clientId: true },
    take: 25,
  });
  for (const m of meetings) {
    seeds.push({
      systemKey: `meeting-prep:${m.id}`,
      title: `Prep for ${m.title}`,
      priority: "MEDIUM",
      dueDate: m.startsAt,
      clientId: m.clientId,
    });
  }

  // Proposals expiring within three days and still unanswered.
  const expiring = await prisma.proposal.findMany({
    where: {
      status: "SENT",
      expiresAt: { gte: now, lte: new Date(now.getTime() + 3 * 24 * 60 * 60_000) },
    },
    select: { id: true, title: true, expiresAt: true },
    take: 25,
  });
  for (const p of expiring) {
    seeds.push({
      systemKey: `proposal-expiring:${p.id}`,
      title: `"${p.title}" expires soon — nudge or extend`,
      priority: "HIGH",
      dueDate: p.expiresAt ?? now,
    });
  }

  if (seeds.length === 0) return;

  // createMany + skipDuplicates leans on the unique systemKey, so this is one
  // round trip regardless of how many conditions currently hold.
  await prisma.task.createMany({
    data: seeds.map((seed) => ({
      systemKey: seed.systemKey,
      title: seed.title,
      priority: seed.priority,
      dueDate: seed.dueDate,
      origin: "SYSTEM" as const,
      assigneeId: owner.id,
      createdById: owner.id,
      clientId: seed.clientId ?? null,
      projectId: seed.projectId ?? null,
      invoiceId: seed.invoiceId ?? null,
      leadId: seed.leadId ?? null,
    })),
    skipDuplicates: true,
  });
}

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
    await chaseOverdueInvoices(now);
    await drainCampaigns(now);
    await generateSystemTasks(now);
  } catch (err) {
    console.error("[duties] run failed:", (err as Error).message);
  }
}
