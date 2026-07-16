import { listMeetings } from "@/lib/dal/meetings";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { PageHeader } from "@/components/page-header";
import { MonthGrid } from "@/components/calendar/month-grid";

export const metadata = { title: "Calendar" };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireAdmin();
  const { month } = await searchParams;

  const now = new Date();
  const [y, m] =
    month && /^\d{4}-\d{2}$/.test(month)
      ? month.split("-").map(Number)
      : [now.getFullYear(), now.getMonth() + 1];
  const monthKey = `${y}-${String(m).padStart(2, "0")}`;
  // Fetch a padded range so leading/trailing grid days show their meetings too.
  const from = new Date(y, m - 1, -7);
  const to = new Date(y, m, 8);

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
      <MonthGrid
        monthKey={monthKey}
        meetings={inRange}
        upcoming={upcoming}
        clients={clients}
        projects={projects}
      />
    </div>
  );
}
