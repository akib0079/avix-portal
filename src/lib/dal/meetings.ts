import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import type { MeetingStatus } from "@prisma/client";

/** Serialized meeting safe for client components (ISO strings only). */
export type MeetingView = {
  id: string;
  title: string;
  notes: string | null;
  startsAt: string; // ISO
  durationMins: number;
  meetingUrl: string | null;
  status: MeetingStatus;
  clientId: string;
  clientName: string;
  clientTimezone: string | null;
  projectId: string | null;
  projectName: string | null;
};

/** What toView needs beside the meeting's own fields. */
export const meetingViewInclude = {
  client: {
    select: { id: true, firstName: true, lastName: true, timezone: true },
  },
  project: { select: { id: true, projectName: true } },
} as const;

type Row = {
  id: string;
  title: string;
  notes: string | null;
  startsAt: Date;
  durationMins: number;
  meetingUrl: string | null;
  status: MeetingStatus;
  client: { id: string; firstName: string; lastName: string; timezone: string | null };
  project: { id: string; projectName: string } | null;
};

export function toView(m: Row): MeetingView {
  return {
    id: m.id,
    title: m.title,
    notes: m.notes,
    startsAt: m.startsAt.toISOString(),
    durationMins: m.durationMins,
    meetingUrl: m.meetingUrl,
    status: m.status,
    clientId: m.client.id,
    clientName: `${m.client.firstName} ${m.client.lastName}`.trim() || "Client",
    clientTimezone: m.client.timezone,
    projectId: m.project?.id ?? null,
    projectName: m.project?.projectName ?? null,
  };
}

/** Admin calendar: everything inside [from, to) plus the next few upcoming. */
export async function listMeetings(from: Date, to: Date) {
  await requireAdmin();
  const [inRange, upcoming] = await Promise.all([
    prisma.meeting.findMany({
      where: { startsAt: { gte: from, lt: to } },
      orderBy: { startsAt: "asc" },
      include: meetingViewInclude,
    }),
    prisma.meeting.findMany({
      where: { startsAt: { gte: new Date() }, status: "SCHEDULED" },
      orderBy: { startsAt: "asc" },
      take: 5,
      include: meetingViewInclude,
    }),
  ]);
  return { inRange: inRange.map(toView), upcoming: upcoming.map(toView) };
}
