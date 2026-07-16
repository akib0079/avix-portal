import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireClient } from "@/lib/dal/session";
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

const include = {
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

function toView(m: Row): MeetingView {
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
      include,
    }),
    prisma.meeting.findMany({
      where: { startsAt: { gte: new Date() }, status: "SCHEDULED" },
      orderBy: { startsAt: "asc" },
      take: 5,
      include,
    }),
  ]);
  return { inRange: inRange.map(toView), upcoming: upcoming.map(toView) };
}

/** Client portal: their next scheduled meetings. */
export async function listMyUpcomingMeetings(): Promise<MeetingView[]> {
  const user = await requireClient();
  const rows = await prisma.meeting.findMany({
    where: { clientId: user.id, status: "SCHEDULED", startsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
    take: 3,
    include,
  });
  return rows.map(toView);
}
