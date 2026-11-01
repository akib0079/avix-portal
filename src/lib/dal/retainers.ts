import "server-only";
import type { InvoiceCurrency, InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { getBookingConfig } from "@/lib/dal/availability";
import {
  dateToDay,
  dayIn,
  planSummary,
  type Day,
  type PlanState,
  type ScheduleUnit,
} from "@/lib/recurring";

/** Serialized plan safe for client components. ADMIN only: plans are money. */
export type RetainerView = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  projectId: string | null;
  projectName: string | null;
  /** Per invoice, in the plan's currency (a template's total when it has one). */
  amount: number;
  currency: InvoiceCurrency;
  /** USD worth of one invoice, for a plan in another currency (MRR only). */
  amountUsd: number | null;
  paymentTermsDays: number | null;
  notes: string | null;
  frequency: ScheduleUnit;
  interval: number;
  dayOfMonth: number;
  active: boolean;
  state: PlanState;
  autoSend: boolean;
  cadence: string;
  /** The next run, agency time; for a paused plan, where it stopped. */
  nextDay: Day | null;
  /** Its run time has come and it hasn't been drafted yet. */
  due: boolean;
  /** The next few runs, nextDay first, stopping at the end. */
  upcoming: Day[];
  /** Invoices still to come, or null when it never ends. */
  remaining: number | null;
  endAfterCount: number | null;
  endDay: Day | null;
  runCount: number;
  /** Why the last run went wrong (a failed auto-send, a broken template). */
  lastRunError: string | null;
  template: { id: string; invoiceNumber: string } | null;
  /** Linked invoices, newest first (the most recent dozen). */
  invoices: RetainerInvoice[];
  invoiceCount: number;
  /** Client's invoices not yet linked to any plan — for the attach picker. */
  attachable: RetainerInvoice[];
};

export type RetainerInvoice = {
  id: string;
  invoiceNumber: string;
  amount: number;
  currency: InvoiceCurrency;
  status: InvoiceStatus;
  issueDate: string;
  /** The plan period it was made for; null when it was attached by hand. */
  period: string | null;
  sent: boolean;
};

const invoiceSelect = {
  id: true,
  invoiceNumber: true,
  amount: true,
  currency: true,
  status: true,
  issueDate: true,
  retainerPeriod: true,
  sentAt: true,
} as const;

function toInvoice(i: {
  id: string;
  invoiceNumber: string;
  amount: unknown;
  currency: InvoiceCurrency;
  status: InvoiceStatus;
  issueDate: Date;
  retainerPeriod: string | null;
  sentAt: Date | null;
}): RetainerInvoice {
  return {
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    amount: Number(i.amount),
    currency: i.currency,
    status: i.status,
    issueDate: i.issueDate.toISOString(),
    period: i.retainerPeriod,
    sent: !!i.sentAt,
  };
}

/**
 * Every plan with its schedule worked out in the agency's zone, its recent
 * invoices and what could be attached to it. One wave: the attachable
 * invoices are found through the plans' clients, not after them.
 */
export async function listRetainers(): Promise<{
  plans: RetainerView[];
  today: Day;
  timeZone: string;
}> {
  await requireAdmin();
  const [rows, unlinked, booking] = await Promise.all([
    prisma.retainer.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        clientId: true,
        projectId: true,
        amount: true,
        currency: true,
        amountUsd: true,
        paymentTermsDays: true,
        notes: true,
        frequency: true,
        interval: true,
        dayOfMonth: true,
        active: true,
        autoSend: true,
        nextRunAt: true,
        endAfterCount: true,
        endDate: true,
        runCount: true,
        lastGeneratedPeriod: true,
        lastRunError: true,
        client: { select: { firstName: true, lastName: true, company: true } },
        project: { select: { projectName: true } },
        templateInvoice: { select: { id: true, invoiceNumber: true } },
        invoices: { orderBy: { issueDate: "desc" }, take: 12, select: invoiceSelect },
        _count: { select: { invoices: true } },
      },
    }),
    prisma.invoice.findMany({
      where: {
        retainerId: null,
        creditNoteForId: null,
        status: { not: "CANCELLED" },
        client: { retainers: { some: {} } },
      },
      orderBy: { issueDate: "desc" },
      take: 200,
      select: { ...invoiceSelect, clientId: true },
    }),
    getBookingConfig(),
  ]);

  const now = new Date();
  const timeZone = booking.agencyTimezone;
  const plans = rows.map((r): RetainerView => {
    const summary = planSummary(r, timeZone, now);
    return {
      id: r.id,
      title: r.title,
      clientId: r.clientId,
      clientName:
        `${r.client.firstName} ${r.client.lastName}`.trim() || r.client.company || "Client",
      projectId: r.projectId,
      projectName: r.project?.projectName ?? null,
      amount: Number(r.amount),
      currency: r.currency,
      amountUsd: r.amountUsd == null ? null : Number(r.amountUsd),
      paymentTermsDays: r.paymentTermsDays,
      notes: r.notes,
      frequency: r.frequency,
      interval: r.interval,
      dayOfMonth: r.dayOfMonth,
      active: r.active,
      state: summary.state,
      autoSend: r.autoSend,
      cadence: summary.cadence,
      nextDay: summary.nextDay,
      due: summary.due,
      upcoming: summary.upcoming,
      remaining: summary.remaining,
      endAfterCount: r.endAfterCount,
      endDay: r.endDate ? dateToDay(r.endDate) : null,
      runCount: r.runCount,
      lastRunError: r.lastRunError,
      template: r.templateInvoice,
      invoices: r.invoices.map(toInvoice),
      invoiceCount: r._count.invoices,
      attachable: unlinked.filter((i) => i.clientId === r.clientId).map(toInvoice),
    };
  });
  return { plans, today: dayIn(now, timeZone), timeZone };
}
