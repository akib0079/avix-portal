import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";

export type BillableLine = {
  description: string;
  qty: number;
  rate: number;
  /** What produced this line, so the UI can explain itself. */
  source: "milestone-fixed" | "milestone-hourly" | "contract";
  milestoneId: string | null;
};

export type BillableWork = {
  projectId: string;
  projectName: string;
  clientId: string | null;
  currency: string;
  lines: BillableLine[];
  /** Σ qty × rate of the lines above. */
  total: number;
  /** Already invoiced against this project (excluding cancelled). */
  alreadyInvoiced: number;
  /** Value of work done that nothing has billed yet. */
  unbilled: number;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Turns work that has actually happened into invoice lines: completed
 * fixed-price milestones, and hours logged against hourly milestones. Without
 * this every invoice was retyped by hand from the milestone board.
 *
 * Deliberately does NOT mark anything as billed — the caller decides whether an
 * invoice is really created, and `alreadyInvoiced` shows what's covered.
 */
export async function getBillableWork(projectId: string): Promise<BillableWork | null> {
  await requireAdmin();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      projectName: true,
      clientId: true,
      billingType: true,
      contractPrice: true,
      milestones: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          status: true,
          pricingType: true,
          fixedPrice: true,
          hourlyRate: true,
        },
      },
      invoices: { select: { amount: true, status: true, currency: true } },
    },
  });
  if (!project) return null;

  // Hours per milestone come from an aggregate — a milestone can hold hundreds
  // of entries and we only need the sum.
  const hourTotals = await prisma.timeEntry.groupBy({
    by: ["milestoneId"],
    where: { milestone: { projectId } },
    _sum: { hours: true },
  });
  const hoursByMilestone = new Map(
    hourTotals.map((row) => [row.milestoneId, Number(row._sum.hours ?? 0)]),
  );

  const lines: BillableLine[] = [];

  if (project.billingType === "CONTRACT") {
    if (project.contractPrice != null) {
      lines.push({
        description: `${project.projectName} — fixed contract`,
        qty: 1,
        rate: Number(project.contractPrice),
        source: "contract",
        milestoneId: null,
      });
    }
  } else {
    for (const milestone of project.milestones) {
      if (milestone.pricingType === "FIXED" && milestone.status === "COMPLETED") {
        lines.push({
          description: milestone.title,
          qty: 1,
          rate: Number(milestone.fixedPrice ?? 0),
          source: "milestone-fixed",
          milestoneId: milestone.id,
        });
      }
      if (milestone.pricingType === "HOURLY") {
        const hours = hoursByMilestone.get(milestone.id) ?? 0;
        if (hours > 0) {
          lines.push({
            description: `${milestone.title} — ${hours}h`,
            qty: hours,
            rate: Number(milestone.hourlyRate ?? 0),
            source: "milestone-hourly",
            milestoneId: milestone.id,
          });
        }
      }
    }
  }

  const total = round(lines.reduce((sum, l) => sum + l.qty * l.rate, 0));
  const alreadyInvoiced = round(
    project.invoices
      .filter((i) => i.status !== "CANCELLED")
      .reduce((sum, i) => sum + Number(i.amount), 0),
  );

  return {
    projectId: project.id,
    projectName: project.projectName,
    clientId: project.clientId,
    currency: project.invoices[0]?.currency ?? "USD",
    lines: lines.filter((l) => l.rate > 0),
    total,
    alreadyInvoiced,
    unbilled: round(Math.max(total - alreadyInvoiced, 0)),
  };
}
