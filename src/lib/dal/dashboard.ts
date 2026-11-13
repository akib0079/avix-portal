import "server-only";
import { cache } from "react";
import { Prisma, type InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/currency";
import { requireAdmin } from "@/lib/dal/session";
import { rangeWindow, type DashboardRange } from "@/lib/dashboard-ranges";
import { workItemHref } from "@/lib/board";
import { AWAITING_REVIEW, INVOICE_TO_PAY, OPEN_REQUEST, PLAN_ITEM, isInvoiceToPay } from "@/lib/work-scope";
import { balanceDue, creditedTotal } from "@/lib/invoice-totals";
import { monthlyUsd } from "@/lib/recurring";
import { paidTrend, projectFlags, toTopClients, type TopClientRow } from "@/lib/dashboard-health";

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

type KpiRow = {
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
  hoursInRange: Prisma.Decimal;
  hoursThisWeek: Prisma.Decimal;
  hoursLastWeek: Prisma.Decimal;
  leadsOpen: bigint;
  leadsOverdue: bigint;
  activeProjects: bigint;
  pendingRequests: bigint;
  target: string | null;
  byStatus: { status: InvoiceStatus; count: number }[];
};

/**
 * Every headline number on the dashboard.
 *
 * The invoice figures used to be eleven separate aggregate queries, and the
 * counts, the target and the lead pipeline seven more. With a five-connection
 * pool that is several round-trip waves before the first number can render,
 * and every statement here holds a pool slot the other sections wait for. Now
 * it is one statement (each aggregate a cross-joined or scalar sub-select)
 * plus the typed retainer read beside it. The FILTER predicates mirror the
 * Prisma `where`s they replaced exactly — `status <> 'PAID'` is
 * `{ not: "PAID" }`, the requests count is OPEN_REQUEST (client requests
 * waiting in the Requested column), and a NULL follow-up is never overdue.
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

  // Issued money only: a draft hasn't been sent, a cancelled invoice is void,
  // and a credit note is money owed to the client, not by them.
  const issued = Prisma.sql`status NOT IN ('DRAFT', 'CANCELLED') AND "creditNoteForId" IS NULL`;
  const unpaid = Prisma.sql`status <> 'PAID' AND ${issued}`;
  const inWindow = Prisma.sql`"issueDate" >= ${ts(win.start)} AND "issueDate" < ${ts(win.end)}`;
  const openLead = Prisma.sql`stage IN ('NEW', 'CONTACTED', 'PROPOSAL')`;

  const [[totals], activePlans] = await Promise.all([
    prisma.$queryRaw<KpiRow[]>`
      SELECT
        i.*,
        h.*,
        l.*,
        (SELECT COUNT(*) FROM projects WHERE status <> 'COMPLETED') AS "activeProjects",
        (SELECT COUNT(*) FROM milestones WHERE "archivedAt" IS NULL AND stage = 'REQUESTED')
          AS "pendingRequests",
        (SELECT value FROM app_settings WHERE key = ${REVENUE_TARGET_KEY}) AS "target",
        (SELECT COALESCE(json_agg(json_build_object('status', s.status, 'count', s.n)), '[]'::json)
          FROM (SELECT status, COUNT(*)::int AS n FROM invoices GROUP BY status) s) AS "byStatus"
      FROM (
        SELECT
          COALESCE(SUM("amountUsd") FILTER (WHERE status = 'PAID' AND ${inWindow}), 0) AS "collected",
          COALESCE(SUM("amountUsd") FILTER (WHERE ${issued} AND ${inWindow}), 0) AS "invoiced",
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
          COUNT(*) FILTER (WHERE "amountUsd" IS NULL AND ${issued}) AS "missingUsd"
        FROM invoices
      ) i
      CROSS JOIN (
        SELECT
          COALESCE(SUM(hours) FILTER (
            WHERE "date" >= ${day(win.start)} AND "date" < ${day(win.end)}
          ), 0) AS "hoursInRange",
          COALESCE(SUM(hours) FILTER (WHERE "date" >= ${day(startOfWeek)}), 0) AS "hoursThisWeek",
          COALESCE(SUM(hours) FILTER (
            WHERE "date" >= ${day(startOfLastWeek)} AND "date" < ${day(startOfWeek)}
          ), 0) AS "hoursLastWeek"
        FROM time_entries
      ) h
      CROSS JOIN (
        SELECT
          COUNT(*) FILTER (WHERE ${openLead}) AS "leadsOpen",
          COUNT(*) FILTER (WHERE ${openLead} AND "nextFollowUp" < ${ts(now)}) AS "leadsOverdue"
        FROM leads
      ) l`,
    // MRR — each active plan's monthly share (a quarterly plan is a third of
    // its amount), in USD through its USD value; never a sum across
    // currencies, which is what adding up retainer.amount was.
    prisma.retainer.findMany({
      where: { active: true },
      select: { amount: true, currency: true, amountUsd: true, frequency: true, interval: true },
    }),
  ]);

  const recurring = monthlyUsd(
    activePlans.map((p) => ({
      amount: Number(p.amount),
      currency: p.currency,
      amountUsd: p.amountUsd == null ? null : Number(p.amountUsd),
      frequency: p.frequency,
      interval: p.interval,
    })),
  );
  const mrr = recurring.total;
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
    target: Number(totals.target ?? 0) || 0,
    activeProjects: Number(totals.activeProjects),
    pendingRequests: Number(totals.pendingRequests),
    hoursInRange: Number(totals.hoursInRange),
    hoursThisWeek: Number(totals.hoursThisWeek),
    hoursLastWeek: Number(totals.hoursLastWeek),
    invoicesByStatus: totals.byStatus,
    /** Open leads, and those whose follow-up date has passed. */
    pipeline: { open: Number(totals.leadsOpen), overdue: Number(totals.leadsOverdue) },
    money: {
      mrr,
      /** Active plans in another currency with no USD value: left out of MRR. */
      mrrMissing: recurring.missing,
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
        milestones: { where: PLAN_ITEM, select: { status: true } },
      },
    }),
    prisma.invoice.findMany({
      where: {
        status: { notIn: ["PAID", "DRAFT", "CANCELLED"] },
        creditNoteForId: null,
        dueDate: { not: null, lte: soon },
      },
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
    | "proposal"
    | "help";
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
    helpRequests,
  ] = await Promise.all([
      // Only what the client can pay: one they say they've paid waits on a
      // "Confirm payment" task instead, and one never sent isn't theirs to
      // chase yet. A few spare rows for those paid or credited off.
      prisma.invoice.findMany({
        where: { ...INVOICE_TO_PAY, dueDate: { not: null, lt: now } },
        orderBy: { dueDate: "asc" },
        take: 10,
        include: {
          client: { select: { firstName: true, lastName: true } },
          creditNotes: { select: { amount: true, status: true } },
        },
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
      // A plan's draft waiting to be reviewed and sent. Found by its plan, not
      // by guessing from the notes (an em dash used to be the tell). DRAFT
      // since v49; plans drafted ASSIGNED invoices before that.
      prisma.invoice.findMany({
        where: { retainerId: { not: null }, status: { in: ["DRAFT", "ASSIGNED"] }, sentAt: null },
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
      // Work sent for the client's review, still waiting on their verdict.
      prisma.milestone.findMany({
        where: AWAITING_REVIEW,
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
      // Client requests sitting in Requested for more than three days.
      prisma.milestone.findMany({
        where: { ...OPEN_REQUEST, createdAt: { lt: threeDaysAgo } },
        orderBy: { createdAt: "asc" },
        take: 5,
        select: {
          id: true,
          title: true,
          createdAt: true,
          projectId: true,
          project: { select: { client: { select: { firstName: true, lastName: true } } } },
        },
      }),
      // Sent proposals about to lapse — worth a nudge.
      prisma.proposal.findMany({
        where: {
          status: "SENT",
          archivedAt: null,
          expiresAt: { not: null, gte: now, lte: inSevenDays },
        },
        orderBy: { expiresAt: "asc" },
        take: 5,
        select: {
          id: true,
          title: true,
          expiresAt: true,
          viewCount: true,
          lead: { select: { name: true } },
          recipientName: true,
        },
      }),
      // Active plans whose next invoice is due and not drafted yet: the duty
      // makes it on its next pass, or Generate now does. (A plan from before
      // schedules has no nextRunAt until that pass gives it one.)
      prisma.retainer.findMany({
        where: {
          active: true,
          OR: [
            { nextRunAt: { lte: now } },
            {
              nextRunAt: null,
              dayOfMonth: { lte: now.getDate() },
              OR: [{ lastGeneratedPeriod: null }, { lastGeneratedPeriod: { not: period } }],
            },
          ],
        },
        orderBy: { nextRunAt: { sort: "asc", nulls: "first" } },
        take: 5,
        select: { id: true, title: true },
      }),
      // A client asked for help on a piece of work and nobody has answered.
      prisma.milestoneComment.findMany({
        where: {
          kind: "HELP",
          authorRole: "CLIENT",
          resolvedAt: null,
          milestone: { archivedAt: null },
        },
        orderBy: { createdAt: "asc" },
        take: 5,
        select: {
          createdAt: true,
          milestone: { select: { id: true, title: true, projectId: true } },
          author: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

  const items: TodayItem[] = [];
  for (const h of helpRequests) {
    const hours = Math.floor((now.getTime() - h.createdAt.getTime()) / 3_600_000);
    const who = h.author ? `${h.author.firstName} ${h.author.lastName}`.trim() : "Client";
    items.push({
      kind: "help",
      label: `${who} needs help — ${h.milestone.title}`,
      detail: hours >= 24 ? `waiting ${Math.floor(hours / 24)} day${hours >= 48 ? "s" : ""}` : "asked on the board",
      link: workItemHref(h.milestone.projectId, h.milestone.id, "ADMIN"),
    });
  }
  const toChase = overdueInvoices
    .map((inv) => {
      const amount = Number(inv.amount);
      const amountPaid = Number(inv.amountPaid);
      const credited = creditedTotal(inv.creditNotes);
      return { ...inv, amount, amountPaid, credited, balance: balanceDue(amount, amountPaid, credited) };
    })
    .filter(isInvoiceToPay)
    .slice(0, 5);
  for (const inv of toChase) {
    const days = Math.floor((now.getTime() - inv.dueDate!.getTime()) / 86_400_000);
    items.push({
      kind: "invoice",
      label: `Chase ${inv.invoiceNumber} — ${inv.client.firstName} ${inv.client.lastName}`,
      // In the invoice's own currency: "$1400" on a EUR invoice is a wrong
      // number. What's left, after payments and credit notes.
      detail: `${formatCurrency(inv.balance, inv.currency)} · ${days} day${days === 1 ? "" : "s"} overdue`,
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
      link: workItemHref(ms.projectId, ms.id, "ADMIN"),
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
    const client = tr.project.client;
    items.push({
      kind: "request",
      label: `Answer request — ${tr.title}`,
      detail: `${client ? `${client.firstName} ${client.lastName}`.trim() : "Client"} · waiting ${days} days`,
      link: workItemHref(tr.projectId, tr.id, "ADMIN"),
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
      // Opened-but-unsigned is the nudge most worth making.
      detail:
        `${p.lead?.name ?? p.recipientName ?? "Recipient"} · expires in ${days} day${days === 1 ? "" : "s"}` +
        (p.viewCount > 0 ? ` · opened ${p.viewCount}x` : " · not opened yet"),
      link: `/admin/proposals?id=${p.id}`,
    });
  }
  for (const r of undraftedRetainers) {
    items.push({
      kind: "retainer",
      label: `Invoice due — ${r.title}`,
      detail: "recurring plan · not drafted yet",
      link: "/admin/retainers",
    });
  }
  for (const inv of retainerDrafts) {
    items.push({
      kind: "retainer",
      label: `Send draft ${inv.invoiceNumber} — ${inv.client.firstName} ${inv.client.lastName}`,
      detail: "Recurring invoice drafted, awaiting review",
      link: `/admin/invoices/${inv.id}`,
    });
  }
  // Most time-critical first: client messages, money, then the rest.
  const order: Record<TodayItem["kind"], number> = {
    help: 0,
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

/** Paid totals (USD) for the last 6 months, oldest first: the deck's trend. */
export const getPaidTrend = cache(async () => {
  await requireAdmin();
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const rows = await prisma.invoice.findMany({
    where: { status: "PAID", issueDate: { gte: sixMonthsAgo }, amountUsd: { not: null } },
    select: { amountUsd: true, issueDate: true },
  });
  return paidTrend(rows, now);
});

/**
 * Projects that look late or stuck. Cached per request: the pulse tiles and
 * the delivery grid both read it.
 */
export const getProjectFlags = cache(async () => {
  await requireAdmin();
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - 14 * 86_400_000);
  const [staleProjects, lateProjects] = await Promise.all([
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
  ]);
  return projectFlags(lateProjects, staleProjects, now);
});

/**
 * Best clients by collected revenue (USD), with how long since we last spoke.
 * Ranked in the database, and the client and their latest message come in the
 * same statement: this used to be a groupBy, then a second wave for the users.
 * USD only, since face value added EUR to USD.
 */
export const getTopClients = cache(async () => {
  await requireAdmin();
  const rows = await prisma.$queryRaw<TopClientRow[]>`
    SELECT
      u.id,
      u."firstName",
      u."lastName",
      u.company,
      t.collected,
      (SELECT MAX(m."createdAt") FROM messages m WHERE m."clientId" = u.id) AS "lastContact"
    FROM (
      SELECT "clientId", SUM("amountUsd") AS collected
      FROM invoices
      WHERE status = 'PAID' AND "amountUsd" IS NOT NULL
      GROUP BY 1
      ORDER BY 2 DESC, 1
      LIMIT 5
    ) t
    JOIN users u ON u.id = t."clientId"
    ORDER BY t.collected DESC, u.id`;
  return toTopClients(rows, new Date());
});
