import { listMeetings } from "@/lib/dal/meetings";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { getBookingConfig } from "@/lib/dal/availability";
import { PageHeader } from "@/components/page-header";
import { CalendarView } from "@/components/calendar/calendar-view";
import { addDays, dayIn, mondayOf, type DayKey } from "@/lib/calendar-days";
import { serverNow } from "@/lib/server-now";

export const metadata = { title: "Calendar" };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** UTC midnight of a day key — a fetch bound, padded either side by the caller. */
function startOf(key: DayKey): Date {
  return new Date(`${key}T00:00:00Z`);
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; week?: string }>;
}) {
  await requireAdmin();
  const [{ month, week }, booking] = await Promise.all([searchParams, getBookingConfig()]);

  // "Today" in the agency's zone, not the host's (which is UTC).
  const renderedAt = serverNow();
  const todayKey = dayIn(new Date(renderedAt), booking.agencyTimezone);

  // Week mode follows ?week=, month mode ?month=; each derives the other so
  // switching views keeps you in the same place.
  let weekKey: DayKey;
  let monthKey: string;
  if (week && DAY_RE.test(week)) {
    weekKey = mondayOf(week);
    monthKey = addDays(weekKey, 3).slice(0, 7); // the month most of the week is in
  } else if (month && MONTH_RE.test(month)) {
    monthKey = month;
    weekKey = mondayOf(todayKey.slice(0, 7) === month ? todayKey : `${month}-01`);
  } else {
    monthKey = todayKey.slice(0, 7);
    weekKey = mondayOf(todayKey);
  }

  // One fetch covers the month grid and the week, padded two days each side
  // so a meeting near midnight still lands on its day in any viewer's zone.
  const gridStart = mondayOf(`${monthKey}-01`);
  const gridEnd = addDays(gridStart, 42);
  const weekEnd = addDays(weekKey, 7);
  const from = startOf(addDays(weekKey < gridStart ? weekKey : gridStart, -2));
  const to = startOf(addDays(weekEnd > gridEnd ? weekEnd : gridEnd, 2));

  const [{ inRange, upcoming }, clients, projects] = await Promise.all([
    listMeetings(from, to),
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
