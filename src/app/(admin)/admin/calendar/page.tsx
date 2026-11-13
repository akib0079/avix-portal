import { listMeetings } from "@/lib/dal/meetings";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { getBookingConfig } from "@/lib/dal/availability";
import { PageHeader } from "@/components/page-header";
import { CalendarView } from "@/components/calendar/calendar-view";
import { dayIn } from "@/lib/calendar-days";
import { calendarRange, fetchWindow } from "@/lib/calendar-window";
import { serverNow } from "@/lib/server-now";

export const metadata = { title: "Calendar" };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; week?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const renderedAt = serverNow();

  // One wave. The meetings used to wait for the agency zone, which decides
  // "today" and so the range; now they come from a window that holds the
  // range in every zone, read beside the zone and trimmed below.
  const span = fetchWindow(params, new Date(renderedAt));
  const [booking, { inRange: inWindow, upcoming }, clients, projects] = await Promise.all([
    getBookingConfig(),
    listMeetings(span.from, span.to),
    prisma.user.findMany({
      where: { role: "CLIENT", status: "ACTIVE" },
      orderBy: { firstName: "asc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        timezone: true,
      },
    }),
    prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, projectName: true, clientId: true },
    }),
  ]);

  // "Today" in the agency's zone, not the host's (which is UTC).
  const todayKey = dayIn(new Date(renderedAt), booking.agencyTimezone);
  const { weekKey, monthKey, from, to } = calendarRange(params, todayKey);
  const inRange = inWindow.filter((m) => {
    const at = Date.parse(m.startsAt);
    return at >= from.getTime() && at < to.getTime();
  });

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Book meetings — clients get an email in their timezone."
      />
      <CalendarView
        monthKey={monthKey}
        weekKey={weekKey}
        todayKey={todayKey}
        meetings={inRange}
        upcoming={upcoming}
        clients={clients}
        projects={projects}
        serverTimezone={booking.agencyTimezone}
        renderedAt={renderedAt}
      />
    </div>
  );
}
