import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";

/** Serialized retainer safe for client components. */
export type RetainerView = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  projectId: string | null;
  projectName: string | null;
  amount: number;
  dayOfMonth: number;
  active: boolean;
  lastGeneratedPeriod: string | null;
  notes: string | null;
};

export async function listRetainers(): Promise<RetainerView[]> {
  await requireAdmin();
  const rows = await prisma.retainer.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    include: {
      client: { select: { firstName: true, lastName: true } },
      project: { select: { projectName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    clientId: r.clientId,
    clientName: `${r.client.firstName} ${r.client.lastName}`.trim() || "Client",
    projectId: r.projectId,
    projectName: r.project?.projectName ?? null,
    amount: Number(r.amount),
    dayOfMonth: r.dayOfMonth,
    active: r.active,
    lastGeneratedPeriod: r.lastGeneratedPeriod,
    notes: r.notes,
  }));
}
