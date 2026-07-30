import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";

export async function getAdminDashboard() {
  await requireAdmin();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in30Days = new Date(now.getTime() + 30 * 86_400_000);
  const days30Ago = new Date(now.getTime() - 30 * 86_400_000);
  const days60Ago = new Date(now.getTime() - 60 * 86_400_000);

  const [
    totalClients,
    activeProjects,
    totalInvoices,
    paidAgg,
    monthPaidAgg,
    outstandingAgg,
    pendingRequests,
    hoursAgg,
    recentProjects,
    invoicesByStatus,
    upcomingInvoices,
    mrrAgg,
    agingCurrent,
    aging30,
    aging60,
    expectedInvoicesAgg,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "CLIENT" } }),
    prisma.project.count({ where: { status: { not: "COMPLETED" } } }),
    prisma.invoice.count(),
    prisma.invoice.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
    prisma.invoice.aggregate({
      where: { status: "PAID", issueDate: { gte: startOfMonth } },
      _sum: { amount: true },
    }),
    prisma.invoice.aggregate({
      where: { status: { not: "PAID" } },
      _sum: { amount: true },
    }),
    prisma.taskRequest.count({ where: { status: "PENDING" } }),
    prisma.timeEntry.aggregate({
      where: { date: { gte: startOfMonth } },
      _sum: { hours: true },
    }),
    prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        client: { select: { firstName: true, lastName: true, company: true } },
      },
    }),
    prisma.invoice.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.invoice.findMany({
      where: { status: { not: "PAID" }, dueDate: { not: null, lte: soon } },
      orderBy: { dueDate: "asc" },
      take: 5,
      include: { client: { select: { firstName: true, lastName: true } } },
    }),
    // MRR — recurring monthly value of all active retainers.
    prisma.retainer.aggregate({ where: { active: true }, _sum: { amount: true } }),
    // Aging: unpaid invoices past due, bucketed by how overdue.
    prisma.invoice.aggregate({
      where: { status: { not: "PAID" }, dueDate: { gte: days30Ago, lt: now } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: { status: { not: "PAID" }, dueDate: { gte: days60Ago, lt: days30Ago } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: { status: { not: "PAID" }, dueDate: { not: null, lt: days60Ago } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    // Expected inflow: unpaid invoices due within the next 30 days.
    prisma.invoice.aggregate({
      where: { status: { not: "PAID" }, dueDate: { gte: now, lte: in30Days } },
      _sum: { amount: true },
    }),
  ]);

  return {
    totalClients,
    activeProjects,
    totalInvoices,
    paidRevenue: Number(paidAgg._sum.amount ?? 0),
    revenueThisMonth: Number(monthPaidAgg._sum.amount ?? 0),
    outstanding: Number(outstandingAgg._sum.amount ?? 0),
    pendingRequests,
    hoursThisMonth: Number(hoursAgg._sum.hours ?? 0),
    recentProjects,
    invoicesByStatus: invoicesByStatus.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
    upcomingInvoices: upcomingInvoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: Number(inv.amount),
      dueDate: inv.dueDate!.toISOString(),
      clientName: `${inv.client.firstName} ${inv.client.lastName}`.trim(),
    })),
    money: {
      mrr: Number(mrrAgg._sum.amount ?? 0),
      // Recurring value expected next 30 days = one-off invoices due soon + MRR.
      expectedNext30:
        Number(expectedInvoicesAgg._sum.amount ?? 0) + Number(mrrAgg._sum.amount ?? 0),
      aging: {
        current: {
          amount: Number(agingCurrent._sum.amount ?? 0),
          count: agingCurrent._count._all,
        },
        thirty: {
          amount: Number(aging30._sum.amount ?? 0),
          count: aging30._count._all,
        },
        sixtyPlus: {
          amount: Number(aging60._sum.amount ?? 0),
          count: aging60._count._all,
        },
      },
    },
  };
}

export type TodayItem = {
  kind:
    | "invoice"
    | "lead"
    | "meeting"
    | "retainer"
    | "message"
    | "approval"
    | "changes"
    | "request"
    | "proposal";
  label: string;
  detail: string;
  link: string;
};

/** "What needs you today" — overdue money, overdue follow-ups, today's meetings, drafts to send. */
export async function getTodayItems(): Promise<TodayItem[]> {
  await requireAdmin();
  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const threeDaysAgo = new Date(now.getTime() - 3 * 86_400_000);
  const inSevenDays = new Date(now.getTime() + 7 * 86_400_000);
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [
    overdueInvoices,
    overdueLeads,
    todaysMeetings,
    retainerDrafts,
    unreadMessages,
    pendingApprovals,
    changeRequests,
    staleRequests,
    expiringProposals,
    undraftedRetainers,
  ] = await Promise.all([
      prisma.invoice.findMany({
        where: { status: { not: "PAID" }, dueDate: { not: null, lt: now } },
        orderBy: { dueDate: "asc" },
        take: 5,
        include: { client: { select: { firstName: true, lastName: true } } },
      }),
      prisma.lead.findMany({
        where: {
          stage: { in: ["NEW", "CONTACTED", "PROPOSAL"] },
          nextFollowUp: { not: null, lt: now },
        },
        orderBy: { nextFollowUp: "asc" },
        take: 5,
      }),
      prisma.meeting.findMany({
        where: { status: "SCHEDULED", startsAt: { gte: now, lt: endOfDay } },
        orderBy: { startsAt: "asc" },
        include: { client: { select: { firstName: true, lastName: true } } },
      }),
      prisma.invoice.findMany({
        where: { status: "ASSIGNED", notes: { contains: "—" } },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { client: { select: { firstName: true, lastName: true } } },
      }),
      // A client wrote and nobody has read/replied yet — the most urgent signal.
      prisma.message.findMany({
        where: { senderRole: "CLIENT", readByAdminAt: null },
        orderBy: { createdAt: "asc" },
        take: 5,
        select: {
          id: true,
          projectId: true,
          createdAt: true,
          client: { select: { firstName: true, lastName: true } },
        },
      }),
      // Completed work still waiting on the client's approval.
      prisma.milestone.findMany({
        where: { status: "COMPLETED", clientApprovedAt: null },
        orderBy: { updatedAt: "asc" },
        take: 5,
        select: {
          id: true,
          title: true,
          projectId: true,
          project: { select: { projectName: true } },
        },
      }),
      // Deliverables the client bounced back for changes.
      prisma.deliverable.findMany({
        where: { reviewStatus: "CHANGES_REQUESTED" },
        orderBy: { reviewedAt: "desc" },
        take: 5,
        select: {
          id: true,
          title: true,
          reviewNote: true,
          projectId: true,
          project: { select: { projectName: true } },
        },
      }),
      // Task requests sitting unanswered for more than three days.
      prisma.taskRequest.findMany({
        where: { status: "PENDING", createdAt: { lt: threeDaysAgo } },
        orderBy: { createdAt: "asc" },
        take: 5,
        select: {
          id: true,
          title: true,
          createdAt: true,
          client: { select: { firstName: true, lastName: true } },
        },
      }),
      // Sent proposals about to lapse — worth a nudge.
      prisma.proposal.findMany({
        where: { status: "SENT", expiresAt: { not: null, gte: now, lte: inSevenDays } },
        orderBy: { expiresAt: "asc" },
        take: 5,
        select: {
          id: true,
          title: true,
          expiresAt: true,
          lead: { select: { name: true } },
          recipientName: true,
        },
      }),
      // Active plans whose bill-on day has passed without a draft this month.
      prisma.retainer.findMany({
        where: {
          active: true,
          dayOfMonth: { lte: now.getDate() },
          OR: [{ lastGeneratedPeriod: null }, { lastGeneratedPeriod: { not: period } }],
        },
        orderBy: { dayOfMonth: "asc" },
        take: 5,
        select: { id: true, title: true, dayOfMonth: true },
      }),
    ]);

  const items: TodayItem[] = [];
  for (const inv of overdueInvoices) {
    const days = Math.floor((now.getTime() - inv.dueDate!.getTime()) / 86_400_000);
    items.push({
      kind: "invoice",
      label: `Chase ${inv.invoiceNumber} — ${inv.client.firstName} ${inv.client.lastName}`,
      detail: `$${Number(inv.amount).toFixed(2)} · ${days} day${days === 1 ? "" : "s"} overdue`,
      link: `/admin/invoices/${inv.id}`,
    });
  }
  for (const lead of overdueLeads) {
    items.push({
      kind: "lead",
      label: `Follow up ${lead.name}`,
      detail: lead.company ?? "Lead follow-up due",
      link: "/admin/leads",
    });
  }
  for (const m of todaysMeetings) {
    items.push({
      kind: "meeting",
      label: `${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(m.startsAt)} — ${m.title}`,
      detail: `with ${m.client.firstName} ${m.client.lastName}`,
      link: "/admin/calendar",
    });
  }
  // Client wrote, unread by us — surfaced first (see the sort below).
  for (const m of unreadMessages) {
    const days = Math.floor((now.getTime() - m.createdAt.getTime()) / 86_400_000);
    items.push({
      kind: "message",
      label: `Reply to ${m.client.firstName} ${m.client.lastName}`.trim(),
      detail: days >= 1 ? `unread for ${days} day${days === 1 ? "" : "s"}` : "unread message",
      link: m.projectId ? `/admin/projects/${m.projectId}` : "/admin/messages",
    });
  }
  for (const ms of pendingApprovals) {
    items.push({
      kind: "approval",
      label: `Awaiting client approval — ${ms.title}`,
      detail: ms.project.projectName,
      link: `/admin/projects/${ms.projectId}`,
    });
  }
  for (const d of changeRequests) {
    items.push({
      kind: "changes",
      label: `Changes requested — ${d.title}`,
      detail: d.reviewNote ? `“${d.reviewNote}”` : d.project.projectName,
      link: `/admin/projects/${d.projectId}`,
    });
  }
  for (const tr of staleRequests) {
    const days = Math.floor((now.getTime() - tr.createdAt.getTime()) / 86_400_000);
    items.push({
      kind: "request",
      label: `Answer request — ${tr.title}`,
      detail: `${tr.client.firstName} ${tr.client.lastName}`.trim() + ` · waiting ${days} days`,
      link: "/admin/task-requests",
    });
  }
  for (const p of expiringProposals) {
    const days = Math.max(
      0,
      Math.ceil((p.expiresAt!.getTime() - now.getTime()) / 86_400_000),
    );
    items.push({
      kind: "proposal",
      label: `Nudge “${p.title}”`,
      detail: `${p.lead?.name ?? p.recipientName ?? "Recipient"} · expires in ${days} day${days === 1 ? "" : "s"}`,
      link: "/admin/proposals",
    });
  }
  for (const r of undraftedRetainers) {
    items.push({
      kind: "retainer",
      label: `Draft this month — ${r.title}`,
      detail: `bills on day ${r.dayOfMonth} · not drafted yet`,
      link: "/admin/retainers",
    });
  }
  for (const inv of retainerDrafts) {
    items.push({
      kind: "retainer",
      label: `Send draft ${inv.invoiceNumber} — ${inv.client.firstName} ${inv.client.lastName}`,
      detail: "Retainer invoice drafted, awaiting review",
      link: `/admin/invoices/${inv.id}`,
    });
  }
  // Most time-critical first: client messages, money, then the rest.
  const order: Record<TodayItem["kind"], number> = {
    message: 0,
    invoice: 1,
    meeting: 2,
    changes: 3,
    request: 4,
    proposal: 5,
    retainer: 6,
    approval: 7,
    lead: 8,
  };
  return items.sort((a, b) => order[a.kind] - order[b.kind]);
}


// ---------- Tier 2: business cockpit ----------

export const REVENUE_TARGET_KEY = "monthlyRevenueTarget";

export type MonthPoint = { label: string; amount: number };

export type BusinessHealth = {
  /** Monthly revenue goal (0 = not set) and progress against collected. */
  target: number;
  collectedThisMonth: number;
  invoicedThisMonth: number;
  /** Paid totals for the last 6 months, oldest first (sparkline). */
  trend: MonthPoint[];
  /** Projects that look stuck or late. */
  flags: {
    id: string;
    name: string;
    clientName: string | null;
    reason: string;
  }[];
  /** Best clients by collected revenue, with how long since we last spoke. */
  topClients: {
    id: string;
    name: string;
    collected: number;
    lastContactDays: number | null;
  }[];
  /** Hours logged this week vs the week before (Tier 3 utilisation). */
  hoursThisWeek: number;
  hoursLastWeek: number;
};

export async function getBusinessHealth(): Promise<BusinessHealth> {
  await requireAdmin();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const staleCutoff = new Date(now.getTime() - 14 * 86_400_000);

  // Week boundaries (Mon-start) for the utilisation comparison.
  const dow = (now.getDay() + 6) % 7;
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const startOfLastWeek = new Date(startOfWeek.getTime() - 7 * 86_400_000);

  const [
    targetRow,
    collectedAgg,
    invoicedAgg,
    paidRows,
    staleProjects,
    lateProjects,
    clientRows,
    weekAgg,
    lastWeekAgg,
  ] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: REVENUE_TARGET_KEY } }),
    prisma.invoice.aggregate({
      where: { status: "PAID", issueDate: { gte: startOfMonth } },
      _sum: { amount: true },
    }),
    prisma.invoice.aggregate({
      where: { issueDate: { gte: startOfMonth } },
      _sum: { amount: true },
    }),
    prisma.invoice.findMany({
      where: { status: "PAID", issueDate: { gte: sixMonthsAgo } },
      select: { amount: true, issueDate: true },
    }),
    // Live projects with nothing touched in a fortnight.
    prisma.project.findMany({
      where: { status: { not: "COMPLETED" }, updatedAt: { lt: staleCutoff } },
      orderBy: { updatedAt: "asc" },
      take: 5,
      select: {
        id: true,
        projectName: true,
        updatedAt: true,
        client: { select: { firstName: true, lastName: true } },
      },
    }),
    // Live projects already past their due date.
    prisma.project.findMany({
      where: { status: { not: "COMPLETED" }, dueDate: { not: null, lt: now } },
      orderBy: { dueDate: "asc" },
      take: 5,
      select: {
        id: true,
        projectName: true,
        dueDate: true,
        client: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: "CLIENT" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        invoices: { where: { status: "PAID" }, select: { amount: true } },
        clientMessages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
    prisma.timeEntry.aggregate({ where: { date: { gte: startOfWeek } }, _sum: { hours: true } }),
    prisma.timeEntry.aggregate({
      where: { date: { gte: startOfLastWeek, lt: startOfWeek } },
      _sum: { hours: true },
    }),
  ]);

  // Six-month paid trend, bucketed by calendar month.
  const buckets = new Map<string, number>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(`${d.getFullYear()}-${d.getMonth()}`, 0);
  }
  for (const inv of paidRows) {
    const key = `${inv.issueDate.getFullYear()}-${inv.issueDate.getMonth()}`;
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + Number(inv.amount));
  }
  const trend: MonthPoint[] = [...buckets.entries()].map(([key, amount]) => {
    const [y, m] = key.split("-").map(Number);
    return {
      label: new Date(y, m, 1).toLocaleString("en-US", { month: "short" }),
      amount,
    };
  });

  const flags = [
    ...lateProjects.map((p) => ({
      id: p.id,
      name: p.projectName,
      clientName: p.client ? `${p.client.firstName} ${p.client.lastName}`.trim() : null,
      reason: `past due ${p.dueDate!.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    })),
    ...staleProjects.map((p) => ({
      id: p.id,
      name: p.projectName,
      clientName: p.client ? `${p.client.firstName} ${p.client.lastName}`.trim() : null,
      reason: `no activity in ${Math.floor((now.getTime() - p.updatedAt.getTime()) / 86_400_000)} days`,
    })),
  ]
    // A project can be both late and stale — show it once.
    .filter((f, i, arr) => arr.findIndex((x) => x.id === f.id) === i)
    .slice(0, 6);

  const topClients = clientRows
    .map((c) => {
      const collected = c.invoices.reduce((sum, i) => sum + Number(i.amount), 0);
      const last = c.clientMessages[0]?.createdAt ?? null;
      return {
        id: c.id,
        name: c.company || `${c.firstName} ${c.lastName}`.trim() || "Client",
        collected,
        lastContactDays: last
          ? Math.floor((now.getTime() - last.getTime()) / 86_400_000)
          : null,
      };
    })
    .sort((a, b) => b.collected - a.collected)
    .slice(0, 5);

  return {
    target: Number(targetRow?.value ?? 0) || 0,
    collectedThisMonth: Number(collectedAgg._sum.amount ?? 0),
    invoicedThisMonth: Number(invoicedAgg._sum.amount ?? 0),
    trend,
    flags,
    topClients,
    hoursThisWeek: Number(weekAgg._sum.hours ?? 0),
    hoursLastWeek: Number(lastWeekAgg._sum.hours ?? 0),
  };
}
