"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { meetingSchema, type MeetingInput } from "@/lib/validation/meeting";
import { sendEmail } from "@/lib/email/resend";
import { appUrl } from "@/lib/app-url";
import { googleCalendarUrl, formatInTimezone } from "@/lib/calendar-links";
import { createMeetingIcsToken } from "@/lib/marketing-token";
import MeetingScheduledEmail from "@/emails/meeting-scheduled";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function notifyClient(
  meeting: {
    id: string;
    title: string;
    notes: string | null;
    startsAt: Date;
    durationMins: number;
    meetingUrl: string | null;
  },
  client: { id: string; firstName: string; email: string; timezone: string | null },
  cancelled: boolean,
) {
  const whenText = formatInTimezone(meeting.startsAt, client.timezone);
  const timezoneLabel = client.timezone
    ? `your time — ${client.timezone.split("/").pop()?.replaceAll("_", " ")}`
    : "UTC";

  await prisma.notification.create({
    data: {
      userId: client.id,
      type: cancelled ? "MEETING_CANCELLED" : "MEETING_SCHEDULED",
      title: cancelled ? `Cancelled: ${meeting.title}` : `Meeting booked: ${meeting.title}`,
      body: whenText,
      link: "/portal",
    },
  });

  await sendEmail({
    to: client.email,
    subject: cancelled
      ? `Cancelled: ${meeting.title}`
      : `Meeting booked — ${meeting.title}`,
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
        cancelled={cancelled}
      />
    ),
    devHint: `meeting ${cancelled ? "cancelled" : "scheduled"} → ${client.email}`,
  });
}

export async function createMeeting(
  input: MeetingInput,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = meetingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const client = await prisma.user.findFirst({
    where: { id: data.clientId, role: "CLIENT" },
    select: { id: true, firstName: true, email: true, status: true, timezone: true },
  });
  if (!client) return { ok: false, error: "Client not found." };

  let projectId: string | null = null;
  if (data.projectId !== "none") {
    const project = await prisma.project.findFirst({
      where: { id: data.projectId, clientId: client.id },
      select: { id: true },
    });
    if (!project) return { ok: false, error: "Project not found for that client." };
    projectId = project.id;
  }

  const startsAt = new Date(data.startsAtIso);
  if (startsAt.getTime() < Date.now() - 60_000) {
    return { ok: false, error: "That time is in the past." };
  }

  const meeting = await prisma.meeting.create({
    data: {
      clientId: client.id,
      projectId,
      title: data.title,
      notes: data.notes || null,
      startsAt,
      durationMins: data.durationMins,
      meetingUrl: data.meetingUrl || null,
    },
  });

  if (client.status === "ACTIVE") {
    await notifyClient(meeting, client, false);
  }

  revalidatePath("/admin/calendar");
  revalidatePath("/portal");
  return { ok: true, data: { id: meeting.id } };
}

export async function cancelMeeting(id: string): Promise<ActionResult> {
  await requireAdmin();
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      client: {
        select: { id: true, firstName: true, email: true, status: true, timezone: true },
      },
    },
  });
  if (!meeting) return { ok: false, error: "Meeting not found." };
  if (meeting.status === "CANCELLED") return { ok: true };

  await prisma.meeting.update({ where: { id }, data: { status: "CANCELLED" } });

  if (meeting.client.status === "ACTIVE") {
    await notifyClient(meeting, meeting.client, true);
  }

  revalidatePath("/admin/calendar");
  revalidatePath("/portal");
  return { ok: true };
}
