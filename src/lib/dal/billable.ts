import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { usdValue } from "@/lib/invoice-usd";
import { billableLines, contractInvoiced, legacyInvoicedUsd } from "@/lib/billable-lines";
import { FIRST_PASS_KEY } from "@/lib/work-backfill";
import type { BillableLine } from "@/lib/billable-lines";

export type { BillableLine } from "@/lib/billable-lines";

export type BillableWork = {
  projectId: string;
  projectName: string;
  clientId: string | null;
  /** Work is priced in dollars. */
  currency: "USD";
  lines: BillableLine[];
  /** Σ qty × rate of the lines above. */
  total: number;
  /**
   * Value of work done that nothing bills yet (the lines above), in USD, less
   * what older invoices may already bill (legacyUsd).
   */
  unbilled: number;
  /**
   * Milestone projects: USD invoiced by the old code on invoices that don't
   * say which work they bill. Some of the lines above may be on them.
   */
  legacyUsd: number;
  /** Contract projects: invoices with no USD value, left out of what has been invoiced. */
  missingUsd: number;
};

/** A project invoice as contractInvoiced reads it. */
export function toContractInvoice(invoice: {
  amount: Prisma.Decimal;
  currency: string;
  amountUsd: Prisma.Decimal | null;
  creditNoteForId: string | null;
  status: string;
}) {
  return {
    usd: usdValue({
      amount: Number(invoice.amount),
      currency: invoice.currency,
      amountUsd: invoice.amountUsd == null ? null : Number(invoice.amountUsd),
    }),
    creditNote: !!invoice.creditNoteForId,
    status: invoice.status,
  };
}

/** The columns toContractInvoice reads. */
export const contractInvoiceSelect = {
  amount: true,
  currency: true,
  amountUsd: true,
  creditNoteForId: true,
  status: true,
} satisfies Prisma.InvoiceSelect;

/** Hours not on any invoice line, or only on a cancelled invoice's. */
export const unbilledHours = {
  OR: [{ invoiceItemId: null }, { invoiceItem: { invoice: { status: "CANCELLED" } } }],
} satisfies Prisma.TimeEntryWhereInput;

/**
 * One wave: the project with its live work (and whether each fixed piece is
 * on a live invoice line), plus the hours no live invoice bills yet, and when
 * the first v49 boot pass ran (older invoices weren't linked to their work).
 * `withEntries` loads the unbilled entries themselves, for the invoice that
 * is about to link them; otherwise their sums are enough.
 */
async function loadWork(projectId: string, withEntries: boolean) {
  const hourly = {
    milestone: { projectId, archivedAt: null, pricingType: "HOURLY" },
  } satisfies Prisma.TimeEntryWhereInput;
  const [project, open, cutover] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        projectName: true,
        clientId: true,
        billingType: true,
        contractPrice: true,
        milestones: {
          where: { archivedAt: null },
          orderBy: { position: "asc" },
          select: {
            id: true,
            title: true,
            status: true,
            pricingType: true,
            fixedPrice: true,
            hourlyRate: true,
            invoiceItems: {
              where: { invoice: { status: { not: "CANCELLED" } } },
              select: { id: true },
              take: 1,
            },
          },
        },
        // A contract bills what is left of its price after what's invoiced.
        // An old invoice with no line linked to work makes Bill work warn.
        invoices: {
          where: { status: { not: "CANCELLED" } },
          select: {
            ...contractInvoiceSelect,
            createdAt: true,
            items: {
              where: { OR: [{ milestoneId: { not: null } }, { timeEntries: { some: {} } }] },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    }),
    withEntries
      ? prisma.timeEntry.findMany({
          where: { ...hourly, ...unbilledHours },
          select: { id: true, milestoneId: true, hours: true },
        })
      : prisma.timeEntry
          .groupBy({
            by: ["milestoneId"],
            where: { ...hourly, ...unbilledHours },
            _sum: { hours: true },
          })
          .then((rows) =>
            rows.map((row) => ({ id: null, milestoneId: row.milestoneId, hours: row._sum.hours })),
          ),
    prisma.appSetting.findUnique({ where: { key: FIRST_PASS_KEY }, select: { value: true } }),
  ]);
  if (!project) return null;

  const invoiced = contractInvoiced(project.invoices.map(toContractInvoice));
  const contractInvoicedUsd = invoiced.usd;

  const unbilled: Record<string, number> = {};
  const entries: Record<string, string[]> = {};
  for (const row of open) {
    unbilled[row.milestoneId] = (unbilled[row.milestoneId] ?? 0) + Number(row.hours ?? 0);
    if (row.id) (entries[row.milestoneId] ??= []).push(row.id);
  }
  const { lines, total } = billableLines({
    projectName: project.projectName,
    billingType: project.billingType,
    contractPrice: project.contractPrice == null ? null : Number(project.contractPrice),
    contractInvoicedUsd,
    contractMissingUsd: invoiced.missing,
    items: project.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      archived: false,
      pricingType: m.pricingType,
      fixedPrice: m.fixedPrice == null ? null : Number(m.fixedPrice),
      hourlyRate: m.hourlyRate == null ? null : Number(m.hourlyRate),
      onLiveInvoice: m.invoiceItems.length > 0,
    })),
    unbilledHours: unbilled,
  });

  // Before the first pass every invoice is the old code's.
  const legacyUsd =
    project.billingType === "MILESTONE"
      ? legacyInvoicedUsd(
          project.invoices.map((i) => ({
            ...toContractInvoice(i),
            createdAt: i.createdAt,
            linked: i.items.length > 0,
          })),
          cutover ? new Date(cutover.value) : new Date(),
        )
      : 0;

  const work: BillableWork = {
    projectId: project.id,
    projectName: project.projectName,
    clientId: project.clientId,
    currency: "USD",
    lines,
    total,
    unbilled: Math.max(Math.round((total - legacyUsd) * 100) / 100, 0),
    legacyUsd,
    missingUsd: project.billingType === "CONTRACT" ? invoiced.missing : 0,
  };
  return { work, entries, contractInvoicedUsd };
}

/**
 * Turns work that has actually happened, and no invoice bills yet, into
 * invoice lines: completed fixed-price work and unbilled hours on hourly
 * work (lib/billable-lines). ADMIN only: it is all prices.
 */
export async function getBillableWork(projectId: string): Promise<BillableWork | null> {
  await requireAdmin();
  return (await loadWork(projectId, false))?.work ?? null;
}

/**
 * The same, with the unbilled time entries behind each hourly line, for the
 * invoice that is about to bill them (createInvoiceFromWork links them).
 */
export async function getBillableWorkToInvoice(projectId: string) {
  await requireAdmin();
  return loadWork(projectId, true);
}
