import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { projectSourceLabels } from "@/lib/format";

/** "YYYY-MM" key in local server time. */
function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleString("en-US", {
    month: "short",
    year: "2-digit",
  });
}

export type ReportsData = {
  kpis: {
    revenueThisMonth: number;
    outstanding: number;
    avgInvoice: number;
    hoursThisMonth: number;
  };
  monthly: { month: string; paid: number; unpaid: number }[];
  bySource: { name: string; value: number }[];
  topClients: {
    id: string;
    name: string;
    company: string | null;
    paid: number;
    outstanding: number;
    projects: number;
  }[];
  /** One row per currency in use; the KPIs are raw sums across all of them. */
  byCurrency: {
    currency: string;
    invoiced: number;
    paid: number;
    outstanding: number;
  }[];
  timeEarnings: {
    totalHours: number;
    earnedFromHours: number;
    totalInvoiced: number;
    totalPaid: number;
  };
};

export async function getReportsData(): Promise<ReportsData> {
  await requireAdmin();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startWindow = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const [invoices, timeEntries, clients, hourlyMilestones] = await Promise.all([
    prisma.invoice.findMany({
      // Cancelled documents and credit notes aren't revenue.
      where: { status: { not: "CANCELLED" }, creditNoteForId: null },
      select: {
        amount: true,
        amountPaid: true,
        currency: true,
        status: true,
        issueDate: true,
        clientId: true,
        project: { select: { source: true } },
      },
    }),
    prisma.timeEntry.findMany({ select: { hours: true, date: true } }),
    prisma.user.findMany({
      where: { role: "CLIENT" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        _count: { select: { projects: true } },
      },
    }),
    prisma.milestone.findMany({
      where: { pricingType: "HOURLY", hourlyRate: { not: null } },
      select: { hourlyRate: true, timeEntries: { select: { hours: true } } },
    }),
  ]);

  // ---- KPIs + monthly buckets
  const monthKeys: string[] = [];
  for (let i = 11; i >= 0; i--) {
    monthKeys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  const monthly = Object.fromEntries(monthKeys.map((k) => [k, { paid: 0, unpaid: 0 }]));

  let revenueThisMonth = 0;
  let outstanding = 0;
  let totalInvoiced = 0;
  let totalPaid = 0;
  const perClient = new Map<string, { paid: number; outstanding: number }>();
  const perSource = new Map<string, number>();
  // Totals per currency, so a EUR invoice never gets added to a USD figure.
  const perCurrency = new Map<string, { invoiced: number; paid: number; outstanding: number }>();

  for (const inv of invoices) {
    const amount = Number(inv.amount);
    // Partial payments are real money: count what was received, not the status.
    const received = Number(inv.amountPaid ?? 0);
    const owing = Math.max(amount - received, 0);

    totalInvoiced += amount;
    totalPaid += received;
    outstanding += owing;
    if (received > 0 && inv.issueDate >= startOfMonth) revenueThisMonth += received;

    const currency = perCurrency.get(inv.currency) ?? {
      invoiced: 0,
      paid: 0,
      outstanding: 0,
    };
    currency.invoiced += amount;
    currency.paid += received;
    currency.outstanding += owing;
    perCurrency.set(inv.currency, currency);

    if (inv.issueDate >= startWindow) {
      const bucket = monthly[monthKey(inv.issueDate)];
      if (bucket) {
        bucket.paid += received;
        bucket.unpaid += owing;
      }
    }

    const client = perClient.get(inv.clientId) ?? { paid: 0, outstanding: 0 };
    client.paid += received;
    client.outstanding += owing;
    perClient.set(inv.clientId, client);

    if (received > 0) {
      const source = inv.project ? projectSourceLabels[inv.project.source] : "No project";
      perSource.set(source, (perSource.get(source) ?? 0) + received);
    }
  }

  // ---- time
  let totalHours = 0;
  let hoursThisMonth = 0;
  for (const entry of timeEntries) {
    const hours = Number(entry.hours);
    totalHours += hours;
    if (entry.date >= startOfMonth) hoursThisMonth += hours;
  }
  const earnedFromHours = hourlyMilestones.reduce(
    (sum, m) =>
      sum +
      Number(m.hourlyRate) * m.timeEntries.reduce((h, e) => h + Number(e.hours), 0),
    0,
  );

  const topClients = clients
    .map((c) => {
      const totals = perClient.get(c.id) ?? { paid: 0, outstanding: 0 };
      return {
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        company: c.company,
        paid: totals.paid,
        outstanding: totals.outstanding,
        projects: c._count.projects,
      };
    })
    .filter((c) => c.paid > 0 || c.outstanding > 0)
    .sort((a, b) => b.paid - a.paid)
    .slice(0, 8);

  const paidCount = invoices.filter((i) => Number(i.amountPaid ?? 0) > 0).length;

  return {
    kpis: {
      revenueThisMonth,
      outstanding,
      avgInvoice: paidCount === 0 ? 0 : totalPaid / paidCount,
      hoursThisMonth,
    },
    monthly: monthKeys.map((k) => ({
      month: monthLabel(k),
      paid: Math.round(monthly[k].paid * 100) / 100,
      unpaid: Math.round(monthly[k].unpaid * 100) / 100,
    })),
    bySource: [...perSource.entries()]
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value),
    topClients,
    timeEarnings: { totalHours, earnedFromHours, totalInvoiced, totalPaid },
    // Shown when more than one currency is in play; the KPIs above are raw sums
    // and only make sense for a single-currency book.
    byCurrency: [...perCurrency.entries()].map(([currency, totals]) => ({
      currency,
      invoiced: Math.round(totals.invoiced * 100) / 100,
      paid: Math.round(totals.paid * 100) / 100,
      outstanding: Math.round(totals.outstanding * 100) / 100,
    })),
  };
}
