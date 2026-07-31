import "server-only";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/dal/session";

export type MyWorkMilestone = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  projectId: string;
  projectName: string;
  clientName: string | null;
  loggedHours: number;
  estimatedHours: number | null;
};

export type MyWork = {
  userId: string;
  milestones: MyWorkMilestone[];
  ownedProjects: { id: string; projectName: string; status: string; dueDate: string | null }[];
  hoursThisWeek: number;
  hoursLastWeek: number;
};

/** Monday 00:00 of the week containing `date`, in server local time. */
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
}

/**
 * One person's plate: the milestones assigned to them, the projects they own,
 * and how much time they logged this week vs last. Scoped to the caller —
 * an `of` id is only honoured for admins, so staff can't read each other.
 */
export async function getMyWork(of?: string): Promise<MyWork> {
  const viewer = await requireTeam();
  const userId = viewer.role === "ADMIN" && of ? of : viewer.id;

  const thisWeek = startOfWeek(new Date());
  const lastWeek = new Date(thisWeek);
  lastWeek.setDate(lastWeek.getDate() - 7);

  const [milestones, ownedProjects, weekEntries] = await Promise.all([
    prisma.milestone.findMany({
      where: { assigneeId: userId, status: { not: "COMPLETED" } },
      orderBy: [{ dueDate: "asc" }, { position: "asc" }],
      take: 100,
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        estimatedHours: true,
        project: {
          select: {
            id: true,
            projectName: true,
            client: { select: { firstName: true, lastName: true, company: true } },
          },
        },
        timeEntries: { select: { hours: true } },
      },
    }),
    prisma.project.findMany({
      where: { ownerId: userId, status: { not: "COMPLETED" } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 50,
      select: { id: true, projectName: true, status: true, dueDate: true },
    }),
    prisma.timeEntry.findMany({
      where: { userId, date: { gte: lastWeek } },
      select: { hours: true, date: true },
    }),
  ]);

  const sum = (from: Date, to?: Date) =>
    weekEntries
      .filter((e) => e.date >= from && (!to || e.date < to))
      .reduce((total, e) => total + Number(e.hours), 0);

  return {
    userId,
    milestones: milestones.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      dueDate: m.dueDate?.toISOString() ?? null,
      projectId: m.project.id,
      projectName: m.project.projectName,
      clientName: m.project.client
        ? m.project.client.company ||
          `${m.project.client.firstName} ${m.project.client.lastName}`.trim()
        : null,
      loggedHours: m.timeEntries.reduce((total, e) => total + Number(e.hours), 0),
      estimatedHours: m.estimatedHours == null ? null : Number(m.estimatedHours),
    })),
    ownedProjects: ownedProjects.map((p) => ({
      id: p.id,
      projectName: p.projectName,
      status: p.status,
      dueDate: p.dueDate?.toISOString() ?? null,
    })),
    hoursThisWeek: sum(thisWeek),
    hoursLastWeek: sum(lastWeek, thisWeek),
  };
}
