import "server-only";
import { prisma } from "@/lib/prisma";
import { balanceDue, creditedTotal } from "@/lib/invoice-totals";
import {
  OVERDUE_GAP_DAYS,
  OVERDUE_STEPS,
  PRE_DUE_DAYS,
  SENT_QUIET_DAYS,
  reminderDue,
} from "@/lib/invoice-reminders";
import { isSecureLink } from "@/lib/validation/invoice";
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
import { getBookingConfig } from "@/lib/dal/availability";
import { planRunSelect, processDuePlan, summarisePlanResults } from "@/lib/recurring-run";

/**
 * "Lazy cron": Hostinger has no background jobs, so scheduled work runs
 * piggybacked on admin page loads — runDueDuties() is called from the admin
 * layout, throttled to at most once per 15 minutes via an AppSetting stamp.
 * Everything here must be idempotent (stamps like reminderSentAt, and a
 * plan's nextRunAt claimed by compare-and-set, make re-runs no-ops).
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
 * Recurring plans (lib/recurring-run): every plan whose next run has come
 * makes that period's invoice, as a draft to review or, for a plan set to
 * send itself, sent once the draft is saved. A plan more than one period
 * behind drafts each missed period, never sends them, and carries on in the
 * next pass after MAX_RUNS_PER_PASS. Plans from before schedules (no
 * nextRunAt) are picked up here and given one.
 *
 * A few plans per pass: each run is several round trips plus, when it sends
 * itself, a PDF and an email, and this runs after an admin page has been
 * served. One plan at a time, because each holds a transaction and the pool
 * is shared with the pages.
 */
const PLAN_BATCH = 5;

async function generateScheduledInvoices(now: Date): Promise<void> {
  const [booking, plans] = await Promise.all([
    getBookingConfig(),
    prisma.retainer.findMany({
      where: { active: true, OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }] },
      orderBy: { nextRunAt: { sort: "asc", nulls: "first" } },
      take: PLAN_BATCH,
      select: planRunSelect,
    }),
  ]);
  if (plans.length === 0) return;

  const results = [];
  for (const plan of plans) {
    results.push(await processDuePlan(plan, now, booking.agencyTimezone));
  }
  await summarisePlanResults(results);
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
 * Payment reminders (lib/invoice-reminders): a friendly note three days
 * before the due date, then reminders 1, 7, 14 and 30 days after it, and
 * nothing after that. Only invoices that were sent and still owe money, never
 * one the client says is paid or the owner paused.
 *
 * Stamp first, by compare-and-set: the run whose write lands sends, so two
 * runs at once can't both email, and a send that fails is not retried on
 * every page load. The query picks only invoices with a reminder due, so the
 * batch is never crowded out by ones that are merely waiting for their next
 * step.
 */
const REMINDER_BATCH = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

async function chaseOverdueInvoices(now: Date): Promise<void> {
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const candidates = await prisma.invoice.findMany({
    where: {
      status: { in: ["SENT", "PARTIALLY_PAID"] },
      creditNoteForId: null,
      remindersPaused: false,
      paymentClaimedAt: null,
      client: { status: "ACTIVE" },
      AND: [
        // The invoice email itself is the reminder for its first two days.
        { OR: [{ sentAt: null }, { sentAt: { lte: daysAgo(SENT_QUIET_DAYS) } }] },
        {
          OR: [
            {
              preDueReminderAt: null,
              dueDate: { gt: now, lte: new Date(now.getTime() + PRE_DUE_DAYS * DAY_MS) },
            },
            // The next overdue step has come due: count n waits for step n,
            // and never within a few days of the last reminder.
            ...OVERDUE_STEPS.map((days, taken) => ({
              reminderCount: taken,
              dueDate: { lte: daysAgo(days) },
              OR: [{ lastReminderAt: null }, { lastReminderAt: { lte: daysAgo(OVERDUE_GAP_DAYS) } }],
            })),
          ],
        },
      ],
    },
    orderBy: { dueDate: "asc" },
    take: REMINDER_BATCH,
    select: {
      id: true,
      invoiceNumber: true,
      amount: true,
      amountPaid: true,
      currency: true,
      status: true,
      dueDate: true,
      sentAt: true,
      reminderCount: true,
      lastReminderAt: true,
      preDueReminderAt: true,
      remindersPaused: true,
      paymentClaimedAt: true,
      creditNoteForId: true,
      payLinkUrl: true,
      client: { select: { id: true, firstName: true, email: true } },
      creditNotes: { select: { amount: true, status: true } },
    },
  });

  for (const invoice of candidates) {
    const balance = balanceDue(
      Number(invoice.amount),
      Number(invoice.amountPaid),
      creditedTotal(invoice.creditNotes),
    );
    const due = reminderDue({ ...invoice, balance }, now);
    if (!due) {
      // Nothing left owing although the status says otherwise: stop picking
      // it up rather than look at it on every run.
      if (balance <= 0) {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { reminderCount: OVERDUE_STEPS.length, preDueReminderAt: invoice.preDueReminderAt ?? now },
        });
      }
      continue;
    }

    const claimed =
      due.kind === "upcoming"
        ? await prisma.invoice.updateMany({
            where: { id: invoice.id, preDueReminderAt: null },
            data: { preDueReminderAt: now },
          })
        : await prisma.invoice.updateMany({
            where: { id: invoice.id, reminderCount: invoice.reminderCount },
            data: { reminderCount: due.step, lastReminderAt: now },
          });
    if (claimed.count === 0) continue;

    const amount = formatMoney(balance, invoice.currency);
    const dueDate = invoice.dueDate!.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const payLinkUrl =
      invoice.payLinkUrl && isSecureLink(invoice.payLinkUrl) ? invoice.payLinkUrl : null;
    await sendEmail({
      to: invoice.client.email,
      subject:
        due.kind === "upcoming"
          ? `Invoice ${invoice.invoiceNumber} is due on ${dueDate}`
          : `Reminder: invoice ${invoice.invoiceNumber} is overdue`,
      react: (
        <InvoiceReminderEmail
          kind={due.kind}
          firstName={invoice.client.firstName || "there"}
          invoiceNumber={invoice.invoiceNumber}
          amount={amount}
          dueDate={dueDate}
          daysOverdue={due.kind === "overdue" ? due.daysOverdue : 0}
          final={due.kind === "overdue" && due.final}
          portalUrl={`${appUrl()}/portal/invoices/${invoice.id}`}
          payLinkUrl={payLinkUrl}
        />
      ),
      devHint: `invoice reminder (${due.kind}) → ${invoice.client.email}`,
    });

    await prisma.notification.create({
      data: {
        userId: invoice.client.id,
        type: "INVOICE_SENT",
        title:
          due.kind === "upcoming"
            ? `Invoice ${invoice.invoiceNumber} is due on ${dueDate}`
            : `Invoice ${invoice.invoiceNumber} is overdue`,
        body:
          due.kind === "upcoming"
            ? `${amount} due on ${dueDate}`
            : `${amount} was due ${due.daysOverdue} day${due.daysOverdue === 1 ? "" : "s"} ago`,
        link: `/portal/invoices/${invoice.id}`,
      },
    });
  }
}

/**
 * Closes the invoice to-dos an invoice has outgrown: any on an invoice now
 * paid or cancelled, and a "Confirm payment" whose claim the owner turned
 * down. Without this they stayed in Tasks after the money had landed.
 */
async function closeSettledInvoiceTasks(now: Date) {
  return prisma.task.updateMany({
    where: {
      origin: "SYSTEM",
      status: { not: "DONE" },
      OR: [
        {
          systemKey: { startsWith: "invoice-" },
          invoice: { status: { in: ["PAID", "CANCELLED"] } },
        },
        {
          systemKey: { startsWith: "invoice-confirm:" },
          invoice: { paymentClaimedAt: null, status: { not: "IN_REVIEW" } },
        },
      ],
    },
    data: { status: "DONE", completedAt: now },
  });
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

  // Invoices: chase the overdue ones, confirm the ones the client says are
  // paid, and close the to-dos of invoices that have moved on. One wave.
  const [overdue, claimed] = await Promise.all([
    // Same set the email chaser uses, so the task and the chase email never
    // disagree about which invoices are actually outstanding. A client who
    // says they've paid is not chased: they get the confirm task below.
    prisma.invoice.findMany({
      where: {
        status: { in: ["SENT", "PARTIALLY_PAID"] },
        paymentClaimedAt: null,
        creditNoteForId: null,
        dueDate: { not: null, lt: now },
      },
      select: { id: true, invoiceNumber: true, clientId: true },
      take: 50,
    }),
    prisma.invoice.findMany({
      where: {
        status: { notIn: ["PAID", "CANCELLED", "DRAFT"] },
        creditNoteForId: null,
        OR: [{ paymentClaimedAt: { not: null } }, { status: "IN_REVIEW" }],
      },
      select: { id: true, invoiceNumber: true, clientId: true, paymentClaimedAt: true },
      take: 50,
    }),
    closeSettledInvoiceTasks(now),
  ]);
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
  for (const inv of claimed) {
    seeds.push({
      // One per claim: a claim turned down and then made again is a new to-do.
      systemKey: `invoice-confirm:${inv.id}:${inv.paymentClaimedAt?.getTime() ?? "review"}`,
      title: `Confirm payment on ${inv.invoiceNumber}`,
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

/**
 * Per-process gate in front of the database throttle. runDueDuties is called
 * after every admin page render (and every router.refresh), and each call used
 * to cost a database round trip just to read the 15-minute stamp. Checking at
 * most once a minute per process keeps that query off nearly every request.
 */
let nextCheckAt = 0;

export async function runDueDuties(): Promise<void> {
  const nowMs = Date.now();
  if (nowMs < nextCheckAt) return;
  nextCheckAt = nowMs + 60_000;
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
    await generateScheduledInvoices(now);
    await chaseOverdueInvoices(now);
    await drainCampaigns(now);
    await generateSystemTasks(now);
  } catch (err) {
    console.error("[duties] run failed:", (err as Error).message);
  }
}
