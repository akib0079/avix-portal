import "server-only";
import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/dal/session";

/**
 * Projects are team-visible (ADMIN + STAFF), but STAFF is money-blind: the
 * stripping below happens SERVER-SIDE so prices never reach a staff session's
 * payload — hiding UI alone would not be enough.
 */

export async function listProjects() {
  const viewer = await requireTeam();
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, company: true } },
      _count: { select: { milestones: true } },
    },
  });
  if (viewer.role === "STAFF") {
    return projects.map((p) => ({ ...p, contractPrice: null }));
  }
  return projects;
}

export async function getProject(id: string) {
  const viewer = await requireTeam();
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          company: true,
          email: true,
          timezone: true,
        },
      },
      milestones: {
        orderBy: { position: "asc" },
        include: { timeEntries: { orderBy: [{ date: "desc" }, { createdAt: "desc" }] } },
      },
      invoices: { orderBy: { createdAt: "desc" } },
    },
  });
  if (project && viewer.role === "STAFF") {
    return {
      ...project,
      contractPrice: null,
      invoices: [],
      milestones: project.milestones.map((m) => ({
        ...m,
        pricingType: "NONE" as const,
        hourlyRate: null,
        fixedPrice: null,
        estimatedHours: null,
      })),
    };
  }
  return project;
}
