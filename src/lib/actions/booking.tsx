"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/lib/dal/session";
import { deriveOpenSlots } from "@/lib/dal/availability";
import { notifyAllAdmins } from "@/lib/dal/notifications";
import { logActivity } from "@/lib/dal/activity";
import { sendEmail } from "@/lib/email/resend";
import { appUrl } from "@/lib/app-url";
import { googleCalendarUrl, formatInTimezone } from "@/lib/calendar-links";
import { createMeetingIcsToken } from "@/lib/marketing-token";
import MeetingScheduledEmail from "@/emails/meeting-scheduled";
import { pushMeeting } from "@/lib/google-calendar";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const DEFAULT_TITLE = "Call with Avix Digital";

/**
 * Client self-books a meeting into an open availability slot. Re-derives the
 * open slots server-side so a client can only book a slot that's genuinely
 * free (defends against stale UI and tampering), then does a final overlap
 * check before creating.
 */
export async function bookMeeting(
  startIso: string,
  note?: string,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireClient();

  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return { ok: false, error: "Invalid time." };

  const { config, slots } = await deriveOpenSlots();
  const slot = slots.find((s) => s.startIso === start.toISOString());
  if (!slot) return { ok: false, error: "That slot is no longer available — pick another." };

  const durationMins = config.slotMinutes;
  const endMs = start.getTime() + durationMins * 60_000;

  const client = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, firstName: true, email: true, timezone: true, status: true },
  });
  if (!client) return { ok: false, error: "Account not found." };

  const meeting = await prisma.$transaction(async (tx) => {
    // Final race guard: reject if any scheduled meeting now overlaps.
    const clash = await tx.meeting.findFirst({
      where: {
        status: "SCHEDULED",
        startsAt: { lt: new Date(endMs), gte: new Date(start.getTime() - 4 * 3_600_000) },
      },
      select: { startsAt: true, durationMins: true },
    });
    if (
      clash &&
      start.getTime() < clash.startsAt.getTime() + clash.durationMins * 60_000 &&
      endMs > clash.startsAt.getTime()
    ) {
      return null;
    }
    return tx.meeting.create({
      data: {
        clientId: client.id,
        title: DEFAULT_TITLE,
        notes: note?.trim().slice(0, 1000) || null,
        startsAt: start,
        durationMins,
        meetingUrl: config.bookingUrl,
      },
    });
  });

  if (!meeting) return { ok: false, error: "That slot was just taken — pick another." };

  // Mirror to Google Calendar (best-effort; no-op unless connected).
  const eventId = await pushMeeting(meeting, client.email);
  if (eventId) {
    await prisma.meeting.update({ where: { id: meeting.id }, data: { googleEventId: eventId } });
  }

  // Notify the client (email + in-app) and the admins.
  const whenText = formatInTimezone(meeting.startsAt, client.timezone);
  const timezoneLabel = client.timezone
    ? `your time — ${client.timezone.split("/").pop()?.replaceAll("_", " ")}`
    : "UTC";

  await prisma.notification.create({
    data: {
      userId: client.id,
      type: "MEETING_SCHEDULED",
      title: `Meeting booked: ${meeting.title}`,
      body: whenText,
      link: "/portal",
    },
  });
  await sendEmail({
    to: client.email,
    subject: `Meeting booked — ${meeting.title}`,
    react: (
      <MeetingScheduledEmail
        firstName={client.firstName || "there"}
        title={meeting.title}
        whenText={whenText}
        timezoneLabel={timezoneLabel}
        durationMins={meeting.durationMins}
        meetingUrl={meeting.meetingUrl}
        notes={meeting.notes}
        googleUrl={googleCalendarUrl(meeting)}
        icsUrl={`${appUrl()}/api/meetings/${meeting.id}/ics?token=${createMeetingIcsToken(meeting.id)}`}
        cancelled={false}
      />
    ),
    devHint: `self-booked meeting → ${client.email}`,
  });

  await notifyAllAdmins({
    type: "MEETING_SCHEDULED",
    title: `${client.firstName || "A client"} booked a meeting`,
    body: whenText,
    link: "/admin/calendar",
  });
  await logActivity({
    type: "meeting.scheduled",
    summary: `${client.firstName || "Client"} self-booked: ${meeting.title}`,
    actorId: client.id,
    clientId: client.id,
    entity: "meeting",
    entityId: meeting.id,
    link: "/admin/calendar",
  });

  revalidatePath("/portal/book");
  revalidatePath("/portal");
  revalidatePath("/admin/calendar");
  return { ok: true, data: { id: meeting.id } };
}
