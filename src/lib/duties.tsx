import "server-only";
import { prisma } from "@/lib/prisma";
import { nextInvoiceNumber } from "@/lib/invoice-number";
import { notifyAllAdmins } from "@/lib/dal/notifications";
import { sendEmail } from "@/lib/email/resend";
import { appUrl } from "@/lib/app-url";
import { googleCalendarUrl, formatInTimezone } from "@/lib/calendar-links";
import { createMeetingIcsToken } from "@/lib/marketing-token";
import MeetingScheduledEmail from "@/emails/meeting-scheduled";

/**
 * "Lazy cron": Hostinger has no background jobs, so scheduled work runs
 * piggybacked on admin page loads — runDueDuties() is called from the admin
 * layout, throttled to at most once per 15 minutes via an AppSetting stamp.
 * Everything here must be idempotent (stamps like reminderSentAt /
 * lastGeneratedPeriod make re-runs no-ops).
 */

const THROTTLE_KEY = "dutiesLastRunAt";
const THROTTLE_MS = 15 * 60 * 1000;

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
          amount: retainer.amount,
          status: "ASSIGNED",
          issueDate: now,
          dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
          notes: `${retainer.title} — ${monthLabel}${retainer.notes ? `\n${retainer.notes}` : ""}`,
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
  } catch (err) {
    console.error("[duties] run failed:", (err as Error).message);
  }
}
