import "server-only";
import { cache } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/currency";
import { requireAdmin } from "@/lib/dal/session";
import { rangeWindow, type DashboardRange } from "@/lib/dashboard-ranges";

export {
  DASHBOARD_RANGES,
  rangeLabels,
  parseRange,
  rangeWindow,
  type DashboardRange,
} from "@/lib/dashboard-ranges";

/** A JS instant as a UTC `timestamp` — how Prisma stores DateTime columns. */
function ts(d: Date) {
  return Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/** A JS instant as a `date`, truncated the way Prisma truncates @db.Date. */
function day(d: Date) {
  return Prisma.sql`${d.toISOString().slice(0, 10)}::date`;
}

type InvoiceTotalsRow = {
  collected: Prisma.Decimal;
  invoiced: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  expected: Prisma.Decimal;
  aging1Amount: Prisma.Decimal;
  aging1Count: bigint;
  aging2Amount: Prisma.Decimal;
  aging2Count: bigint;
  aging3Amount: Prisma.Decimal;
  aging3Count: bigint;
  missingUsd: bigint;
};

type HoursRow = { inRange: Prisma.Decimal; thisWeek: Prisma.Decimal; lastWeek: Prisma.Decimal };

/**
 * Every headline number on the dashboard.
 *
 * The invoice figures used to be eleven separate aggregate queries. With a
 * five-connection pool that is three round-trip waves before the first number
 * can render; as one FILTERed pass over `invoices` it is one. Same for the
 * three time-entry sums. The FILTER predicates mirror the Prisma `where`s they
 * replaced exactly — `status <> 'PAID'` is `{ not: "PAID" }`.
 *
 * Wrapped in cache() because several dashboard sections read it and must not
 * each pay for it.
 */
export const getDashboardKpis = cache(async (range: DashboardRange = "month") => {
  await requireAdmin();

  const now = new Date();
  const win = rangeWindow(range, now);
  const in30Days = new Date(now.getTime() + 30 * 86_400_000);
  const days30Ago = new Date(now.getTime() - 30 * 86_400_000);
  const days60Ago = new Date(now.getTime() - 60 * 86_400_000);
  // Week boundaries (Mon-start) for the utilisation comparison.
  const dow = (now.getDay() + 6) % 7;
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const startOfLastWeek = new Date(startOfWeek.getTime() - 7 * 86_400_000);

  const unpaid = Prisma.sql`status <> 'PAID'`;
  const inWindow = Prisma.sql`"issueDate" >= ${ts(win.start)} AND "issueDate" < ${ts(win.end)}`;

  const [
    [totals],
    [hours],
    invoicesByStatus,
    mrrAgg,
    targetRow,
    activeProjects,
    pendingRequests,
  ] = await Promise.all([
    prisma.$queryRaw<InvoiceTotalsRow[]>`
      SELECT
        COALESCE(SUM("amountUsd") FILTER (WHERE status = 'PAID' AND ${inWindow}), 0) AS "collected",
        COALESCE(SUM("amountUsd") FILTER (WHERE ${inWindow}), 0) AS "invoiced",
        COALESCE(SUM("amountUsd") FILTER (WHERE ${unpaid}), 0) AS "outstanding",
        COALESCE(SUM("amountUsd") FILTER (
          WHERE ${unpaid} AND "dueDate" >= ${ts(now)} AND "dueDate" <= ${ts(in30Days)}
        ), 0) AS "expected",
        COALESCE(SUM("amountUsd") FILTER (
          WHERE ${unpaid} AND "dueDate" >= ${ts(days30Ago)} AND "dueDate" < ${ts(now)}
        ), 0) AS "aging1Amount",
        COUNT(*) FILTER (
          WHERE ${unpaid} AND "dueDate" >= ${ts(days30Ago)} AND "dueDate" < ${ts(now)}
        ) AS "aging1Count",
        COALESCE(SUM("amountUsd") FILTER (
          WHERE ${unpaid} AND "dueDate" >= ${ts(days60Ago)} AND "dueDate" < ${ts(days30Ago)}
        ), 0) AS "aging2Amount",
        COUNT(*) FILTER (
          WHERE ${unpaid} AND "dueDate" >= ${ts(days60Ago)} AND "dueDate" < ${ts(days30Ago)}
        ) AS "aging2Count",
        COALESCE(SUM("amountUsd") FILTER (WHERE ${unpaid} AND "dueDate" < ${ts(days60Ago)}), 0)
          AS "aging3Amount",
        COUNT(*) FILTER (WHERE ${unpaid} AND "dueDate" < ${ts(days60Ago)}) AS "aging3Count",
        COUNT(*) FILTER (WHERE "amountUsd" IS NULL) AS "missingUsd"
      FROM invoices`,
    prisma.$queryRaw<HoursRow[]>`
      SELECT
        COALESCE(SUM(hours) FILTER (
          WHERE "date" >= ${day(win.start)} AND "date" < ${day(win.end)}
        ), 0) AS "inRange",
        COALESCE(SUM(hours) FILTER (WHERE "date" >= ${day(startOfWeek)}), 0) AS "thisWeek",
        COALESCE(SUM(hours) FILTER (
          WHERE "date" >= ${day(startOfLastWeek)} AND "date" < ${day(startOfWeek)}
        ), 0) AS "lastWeek"
      FROM time_entries`,
    prisma.invoice.groupBy({ by: ["status"], _count: { _all: true } }),
    // MRR — recurring monthly value of all active retainers.
    prisma.retainer.aggregate({ where: { active: true }, _sum: { amount: true } }),
    prisma.appSetting.findUnique({ where: { key: REVENUE_TARGET_KEY } }),
    prisma.project.count({ where: { status: { not: "COMPLETED" } } }),
    prisma.taskRequest.count({ where: { status: "PENDING" } }),
  ]);

  const mrr = Number(mrrAgg._sum.amount ?? 0);
  const bucket = (amount: Prisma.Decimal, count: bigint) => ({
    amount: Number(amount),
    count: Number(count),
  });

  return {
    /** Paid (USD) with an issue date inside the selected range. */
    collected: Number(totals.collected),
    /** Everything issued inside the selected range, paid or not (USD). */
    invoiced: Number(totals.invoiced),
    outstanding: Number(totals.outstanding),
    /** Non-USD invoices awaiting a USD value; excluded from every total here. */
    invoicesMissingUsd: Number(totals.missingUsd),
    /** Monthly revenue goal (0 = not set). */
    target: Number(targetRow?.value ?? 0) || 0,
    activeProjects,
    pendingRequests,
    hoursInRange: Number(hours.inRange),
    hoursThisWeek: Number(hours.thisWeek),
    hoursLastWeek: Number(hours.lastWeek),
    invoicesByStatus: invoicesByStatus.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
    money: {
      mrr,
      // Expected next 30 days = one-off invoices due soon + MRR.
      expectedNext30: Number(totals.expected) + mrr,
      aging: {
        current: bucket(totals.aging1Amount, totals.aging1Count),
        thirty: bucket(totals.aging2Amount, totals.aging2Count),
        sixtyPlus: bucket(totals.aging3Amount, totals.aging3Count),
      },
    },
  };
});

/** How many calendar months a range spans — scales a monthly target to it. */
export function monthsInRange(range: DashboardRange, now = new Date()): number {
  const { start, end } = rangeWindow(range, now);
  return (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
}

export type DashboardKpis = Awaited<ReturnType<typeof getDashboardKpis>>;

/** The two lists under the fold: newest projects and invoices falling due. */
export const getDashboardLists = cache(async () => {
  await requireAdmin();
  const soon = new Date(Date.now() + 7 * 86_400_000);
  const [recentProjects, upcomingInvoices] = await Promise.all([
    prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        projectName: true,
        type: true,
        status: true,
        client: { select: { firstName: true, lastName: true } },
        milestones: { select: { status: true } },
      },
    }),
    prisma.invoice.findMany({
      where: { status: { not: "PAID" }, dueDate: { not: null, lte: soon } },
      orderBy: { dueDate: "asc" },
      take: 5,
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        currency: true,
        dueDate: true,
        client: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  return {
    recentProjects: recentProjects.map((p) => ({
      id: p.id,
      projectName: p.projectName,
      type: p.type,
      status: p.status,
      clientName: p.client ? `${p.client.firstName} ${p.client.lastName}`.trim() : null,
      milestonesDone: p.milestones.filter((m) => m.status === "COMPLETED").length,
      milestonesTotal: p.milestones.length,
    })),
    upcomingInvoices: upcomingInvoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: Number(inv.amount),
      currency: inv.currency,
      dueDate: inv.dueDate!.toISOString(),
      clientName: `${inv.client.firstName} ${inv.client.lastName}`.trim(),
    })),
  };
});

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
export const getTodayItems = cache(async (): Promise<TodayItem[]> => {
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
      // In the invoice's own currency: "$1400" on a EUR invoice is a wrong number.
      detail: `${formatCurrency(Number(inv.amount), inv.currency)} · ${days} day${days === 1 ? "" : "s"} overdue`,
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
});


// ---------- Tier 2: business cockpit ----------

export const REVENUE_TARGET_KEY = "monthlyRevenueTarget";

export type MonthPoint = { label: string; amount: number };

export type BusinessHealth = {
  /** Paid totals (USD) for the last 6 months, oldest first. */
  trend: MonthPoint[];
  /** Projects that look stuck or late. */
  flags: {
    id: string;
    name: string;
    clientName: string | null;
    reason: string;
    kind: "late" | "stale";
  }[];
  /** Best clients by collected revenue, with how long since we last spoke. */
  topClients: {
    id: string;
    name: string;
    collected: number;
    lastContactDays: number | null;
  }[];
};

/** Cached per request: the deck, the pulse tiles and the money grid all read it. */
export const getBusinessHealth = cache(async (): Promise<BusinessHealth> => {
  await requireAdmin();
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const staleCutoff = new Date(now.getTime() - 14 * 86_400_000);

  const [paidRows, staleProjects, lateProjects, topRows] = await Promise.all([
    prisma.invoice.findMany({
      where: { status: "PAID", issueDate: { gte: sixMonthsAgo }, amountUsd: { not: null } },
      select: { amountUsd: true, issueDate: true },
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
    // Ranked in the database. This used to load every client with every paid
    // invoice and sort in JS — a query that grew with the whole ledger to
    // show five rows. Also USD now: face value added EUR to USD.
    prisma.invoice.groupBy({
      by: ["clientId"],
      where: { status: "PAID", amountUsd: { not: null } },
      _sum: { amountUsd: true },
      orderBy: { _sum: { amountUsd: "desc" } },
      take: 5,
    }),
  ]);

  const top = await prisma.user.findMany({
    where: { id: { in: topRows.map((r) => r.clientId) } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      clientMessages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  const byId = new Map(top.map((u) => [u.id, u]));

  // Six-month paid trend, bucketed by calendar month.
  const buckets = new Map<string, number>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(`${d.getFullYear()}-${d.getMonth()}`, 0);
  }
  for (const inv of paidRows) {
    const key = `${inv.issueDate.getFullYear()}-${inv.issueDate.getMonth()}`;
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + Number(inv.amountUsd));
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
      kind: "late" as const,
    })),
    ...staleProjects.map((p) => ({
      id: p.id,
      name: p.projectName,
      clientName: p.client ? `${p.client.firstName} ${p.client.lastName}`.trim() : null,
      reason: `no activity in ${Math.floor((now.getTime() - p.updatedAt.getTime()) / 86_400_000)} days`,
      kind: "stale" as const,
    })),
  ]
    // A project can be both late and stale — show it once.
    .filter((f, i, arr) => arr.findIndex((x) => x.id === f.id) === i)
    .slice(0, 6);

  const topClients = topRows.flatMap((row) => {
    const c = byId.get(row.clientId);
    if (!c) return [];
    const last = c.clientMessages[0]?.createdAt ?? null;
    return [
      {
        id: c.id,
        name: c.company || `${c.firstName} ${c.lastName}`.trim() || "Client",
        collected: Number(row._sum.amountUsd ?? 0),
        lastContactDays: last
          ? Math.floor((now.getTime() - last.getTime()) / 86_400_000)
          : null,
      },
    ];
  });

  return { trend, flags, topClients };
});
