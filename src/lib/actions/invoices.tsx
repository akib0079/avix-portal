"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { usdToStore } from "@/lib/invoice-usd";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { parseInvoiceForm } from "@/lib/invoice-form-data";
import { createWithNextNumber } from "@/lib/invoice-number";
import { creditedTotal, dueDateFromTerms, invoiceTotals } from "@/lib/invoice-totals";
import { canDeleteInvoice, paymentBlocker } from "@/lib/invoice-rules";
import {
  MARKED_PAID,
  addPayment,
  cents,
  createPreparedInvoice,
  formColumns,
  formStatus,
  itemRows,
  moneySelect,
  parseDate,
  prepareInvoice,
  resolveRefs,
  settleIfRaced,
  settledStatus,
} from "@/lib/invoice-write";
import {
  contractInvoiceSelect,
  getBillableWorkToInvoice,
  toContractInvoice,
  unbilledHours,
} from "@/lib/dal/billable";
import { contractInvoiced } from "@/lib/billable-lines";
import { todayIn } from "@/lib/invoice-copy";
import { listInvoiceProjectOptions } from "@/lib/dal/invoices";
import { saveUpload, deleteUpload } from "@/lib/uploads";
import { logActivity } from "@/lib/dal/activity";
import { sendInvoiceCore } from "@/lib/invoice-send";
import { formatCurrency } from "@/lib/currency";
import { getBookingConfig } from "@/lib/dal/availability";
import { itemWrites } from "@/lib/invoice-items";
import { repeatSchema, type RepeatInput } from "@/lib/validation/retainer";
import {
  dayIn,
  dayToDate,
  periodKey,
  scheduleColumns,
  scheduleProblem,
} from "@/lib/recurring";
import { runPlanIfDue } from "@/lib/recurring-run";
import type { PlanSeed } from "@/lib/invoice-write";
import type { InvoiceStatus } from "@prisma/client";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/**
 * A credit note's amount or status changed, so what it takes off the invoice
 * it credits did too: re-settle that invoice (a cancelled credit note puts
 * the money back to being owed).
 */
async function resettleCredited(invoiceId: string | null): Promise<void> {
  if (!invoiceId) return;
  const parent = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: moneySelect });
  if (!parent) return;
  const status = settledStatus(parent);
  if (status !== parent.status) {
    await prisma.invoice.update({ where: { id: parent.id }, data: { status } });
  }
  revalidatePath(invoiceLink(parent.id));
}

/** Why the payments rule out a status the owner picked, in their terms. */
function statusConflict(requested: InvoiceStatus, settled: InvoiceStatus): string {
  if (requested === "PARTIALLY_PAID") {
    return settled === "PAID"
      ? "The payments recorded already cover this invoice in full."
      : "Record the part payment first. Part paid follows the money that came in.";
  }
  if (settled === "PAID") {
    return "This invoice is paid in full. Remove a payment before changing its status.";
  }
  if (settled === "PARTIALLY_PAID") {
    return "Part of this invoice is paid, so it stays Part paid until the rest comes in or a payment is removed.";
  }
  return "That status doesn't match the payments recorded on this invoice.";
}

function invoiceLink(id: string) {
  return `/admin/invoices/${id}`;
}

function revalidateInvoice(id: string) {
  revalidatePath("/admin/invoices");
  revalidatePath(invoiceLink(id));
  revalidatePath("/admin");
}

/** Stores an uploaded PDF, if the form carried one. */
async function handlePdf(formData: FormData): Promise<
  { ok: true; fileName: string | null; originalName: string | null } | { ok: false; error: string }
> {
  const file = formData.get("pdf");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: true, fileName: null, originalName: null };
  }
  const saved = await saveUpload("invoices", file);
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, fileName: saved.fileName, originalName: file.name.slice(0, 255) };
}

/**
 * The Repeat section of a new invoice, posted beside the form's fields as
 * one JSON value: absent when the invoice doesn't repeat.
 */
function readRepeat(
  formData: FormData,
): { ok: true; repeat: RepeatInput | null } | { ok: false; error: string } {
  const raw = formData.get("repeat");
  if (typeof raw !== "string" || raw === "") return { ok: true, repeat: null };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The repeat settings couldn't be read. Set them again." };
  }
  const parsed = repeatSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the repeat settings." };
  }
  return { ok: true, repeat: parsed.data };
}

export async function createInvoice(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = parseInvoiceForm(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const repeat = readRepeat(formData);
  if (!repeat.ok) return { ok: false, error: repeat.error };

  const [ready, booking] = await Promise.all([
    prepareInvoice(data),
    repeat.repeat ? getBookingConfig() : null,
  ]);
  if (!ready.ok) return { ok: false, error: ready.error };

  // Made recurring as it is created: the plan copies this invoice for each
  // new period, starting after the one this invoice covers.
  let plan: PlanSeed | undefined;
  let period: string | undefined;
  const timeZone = booking?.agencyTimezone;
  if (repeat.repeat && timeZone) {
    const { title, schedule } = repeat.repeat;
    if (ready.prepared.status === "CANCELLED") {
      return { ok: false, error: "A cancelled invoice can't repeat." };
    }
    period = periodKey(data.issueDate, schedule.frequency);
    const problem = scheduleProblem(schedule, {
      today: dayIn(new Date(), timeZone),
      runCount: 1,
      coveredPeriod: period,
    });
    if (problem) return { ok: false, error: problem };
    const { columns } = ready.prepared;
    plan = {
      clientId: columns.clientId,
      projectId: columns.projectId,
      title,
      amount: columns.amount,
      currency: columns.currency,
      amountUsd: columns.amountUsd,
      paymentTermsDays: columns.paymentTermsDays,
      active: true,
      ...scheduleColumns(schedule, timeZone),
      startDate: dayToDate(schedule.nextDate),
      // This invoice is the plan's first.
      runCount: 1,
      lastGeneratedPeriod: schedule.frequency === "MONTH" ? period : null,
    };
  }

  const pdf = await handlePdf(formData);
  if (!pdf.ok) return { ok: false, error: pdf.error };

  const invoice = await createPreparedInvoice(
    ready.prepared,
    {
      pdfPath: pdf.fileName,
      pdfOriginalName: pdf.originalName,
      ...(period ? { retainerPeriod: period } : {}),
    },
    plan,
  );

  const planId = invoice.retainerId;
  if (planId && timeZone && plan && (plan.nextRunAt as Date).getTime() <= Date.now()) {
    after(() => runPlanIfDue(planId, timeZone));
  }
  revalidatePath("/admin/invoices");
  revalidatePath("/admin");
  if (planId) revalidatePath("/admin/retainers");
  return { ok: true, data: { id: invoice.id } };
}

export async function updateInvoice(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = parseInvoiceForm(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const [invoice, refs] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id },
      select: {
        ...moneySelect,
        pdfPath: true,
        dueDate: true,
        retainer: { select: { title: true } },
        retainerTemplateFor: { select: { title: true } },
        // Which lines bill tracked work, so the edit keeps them (lib/invoice-items).
        items: {
          select: { id: true, milestoneId: true, _count: { select: { timeEntries: true } } },
        },
      },
    }),
    resolveRefs(data, id),
  ]);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if ("error" in refs) return { ok: false, error: refs.error };
  // A plan bills one client. Its invoices and its template stay with it.
  if (data.clientId !== invoice.clientId) {
    if (invoice.retainer) {
      return {
        ok: false,
        error: `This invoice is part of the recurring plan “${invoice.retainer.title}”, which bills its current client. Unlink it from the plan first.`,
      };
    }
    const copiedBy = invoice.retainerTemplateFor[0];
    if (copiedBy) {
      return {
        ok: false,
        error: `This invoice is the template for the recurring plan “${copiedBy.title}”, which bills its current client. Give the plan another template first.`,
      };
    }
  }
  const columns = formColumns(data, refs);
  const next = formStatus(invoice, data.status, columns.amount);
  if ("error" in next) return { ok: false, error: next.error };

  const pdf = await handlePdf(formData);
  if (!pdf.ok) return { ok: false, error: pdf.error };

  // A new due date restarts the reminder schedule against it: the steps
  // count from the due date, and the old ones were for a date that moved.
  const dueMoved = (columns.dueDate?.getTime() ?? null) !== (invoice.dueDate?.getTime() ?? null);

  // Lines that bill tracked work are kept in place, with their links; the
  // rest are replaced. A linked line the edit dropped frees its work.
  const linked = new Set(
    invoice.items.filter((i) => i.milestoneId || i._count.timeEntries > 0).map((i) => i.id),
  );
  const lines = itemWrites(data.items ?? [], linked);
  const rows = itemRows(data.items);

  // Batched rather than interactive: none of these writes needs another's
  // result. amountPaid moves in place, as it does for any other payment.
  await prisma.$transaction([
    prisma.invoiceItem.deleteMany({
      where: {
        invoiceId: id,
        ...(lines.keepIds.length > 0 ? { id: { notIn: lines.keepIds } } : {}),
      },
    }),
    ...lines.update.map((line) =>
      prisma.invoiceItem.update({ where: { id: line.id }, data: rows[line.index] }),
    ),
    prisma.invoice.update({
      where: { id },
      data: {
        // A blank number field keeps the current number.
        ...(refs.customNumber ? { invoiceNumber: refs.customNumber } : {}),
        ...columns,
        status: next.status,
        ...(next.markPaid > 0 ? { amountPaid: { increment: next.markPaid } } : {}),
        ...(next.clearClaim ? { paymentClaimedAt: null } : {}),
        ...(dueMoved ? { reminderCount: 0, preDueReminderAt: null } : {}),
        ...(pdf.fileName
          ? { pdfPath: pdf.fileName, pdfOriginalName: pdf.originalName }
          : {}),
        items: { create: lines.create.map((line) => rows[line.index]) },
      },
    }),
    ...(next.markPaid > 0
      ? [
          prisma.invoicePayment.create({
            data: { invoiceId: id, amount: next.markPaid, paidAt: new Date(), method: MARKED_PAID },
          }),
        ]
      : []),
    // A template's plans bill what it bills from now on, so their amount (and
    // the MRR it feeds) follows the edit. A USD value not known yet keeps the
    // plan's own, unless the currency changed under it.
    ...(invoice.retainerTemplateFor.length > 0
      ? [
          prisma.retainer.updateMany({
            where: { templateInvoiceId: id },
            data: {
              amount: columns.amount,
              currency: columns.currency,
              paymentTermsDays: columns.paymentTermsDays,
              ...(columns.amountUsd != null
                ? { amountUsd: columns.amountUsd }
                : columns.currency !== invoice.currency
                  ? { amountUsd: null }
                  : {}),
            },
          }),
        ]
      : []),
  ]);

  await resettleCredited(invoice.creditNoteForId);

  // Only now is the old file safe to drop. Deleting it before the update meant
  // any later failure — a rejected rename, a transaction rollback — left the
  // invoice row pointing at a PDF that no longer existed.
  const replaced = pdf.fileName ? invoice.pdfPath : null;
  if (replaced) after(() => deleteUpload("invoices", replaced));

  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${id}`);
  revalidatePath("/admin");
  if (invoice.retainerTemplateFor.length > 0) revalidatePath("/admin/retainers");
  return { ok: true };
}

/**
 * The status menu and the board's drag. Status follows the money, so a status
 * the payments contradict is refused rather than written: marking an invoice
 * paid used to leave amountPaid at 0, so it stayed in the Open filter and the
 * aging buckets while its PDF said PAID.
 *
 * PAID with a balance left records that balance as a payment ("Marked paid"),
 * which is what the owner means by it. The UI opens the payment dialog first,
 * prefilled with the balance; this is the backstop for everything else.
 */
export async function setInvoiceStatus(
  id: string,
  status: InvoiceStatus,
): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await prisma.invoice.findUnique({ where: { id }, select: moneySelect });
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (status === invoice.status) return { ok: true };

  const next = formStatus(invoice, status, Number(invoice.amount));
  if ("error" in next) return { ok: false, error: next.error };
  if (next.status !== status) return { ok: false, error: statusConflict(status, next.status) };

  if (next.markPaid > 0) {
    await addPayment(
      invoice,
      { amount: next.markPaid, paidAt: new Date(), method: MARKED_PAID, note: null },
      "PAID",
    );
  } else {
    await prisma.invoice.update({
      where: { id },
      data: { status, ...(next.clearClaim ? { paymentClaimedAt: null } : {}) },
    });
  }

  await resettleCredited(invoice.creditNoteForId);

  const money = formatCurrency(Number(invoice.amount), invoice.currency);
  if (status === "PAID" || status === "CANCELLED") {
    after(() =>
      logActivity({
        type: status === "PAID" ? "invoice.paid" : "invoice.cancelled",
        summary:
          status === "PAID"
            ? `Invoice ${invoice.invoiceNumber} marked paid · ${money}`
            : `Invoice ${invoice.invoiceNumber} cancelled · ${money}`,
        clientId: invoice.clientId,
        projectId: invoice.projectId,
        entity: "invoice",
        entityId: invoice.id,
        link: invoiceLink(invoice.id),
      }),
    );
  }
  revalidateInvoice(id);
  return { ok: true };
}

/**
 * Project choices for the invoice form when the client changes: that client's
 * projects and unassigned ones, instead of every project loaded up front.
 */
export async function listInvoiceProjects(clientId: string) {
  await requireAdmin();
  return listInvoiceProjectOptions({ clientId });
}

/**
 * The admin's "Send to client". The sending itself is sendInvoiceCore, which
 * a recurring plan's auto-send shares; this is where it is authorized.
 */
export async function sendInvoice(id: string): Promise<ActionResult> {
  await requireAdmin();
  const result = await sendInvoiceCore(id);
  if (!result.ok) return result;
  revalidateInvoice(id);
  return { ok: true };
}

/** Work that was billed on another invoice between reading it and saving. */
class BilledMeanwhile extends Error {}

/**
 * Draft an invoice straight from work that has happened and no invoice bills
 * yet (lib/billable-lines): the lines the owner ticked, from completed
 * fixed-price work, unbilled hours and what's left of a contract. Each line
 * is linked to the work it bills in the same transaction (the milestone on
 * the line, the hours to the line), so pressing "Bill work" again offers
 * only what's new, and cancelling the invoice frees its work. Created as a
 * DRAFT, which the client can't see, worth its total in USD.
 */
export async function createInvoiceFromWork(
  projectId: string,
  options?: {
    /** BillableLine keys to include; all of them when left out. */
    lines?: string[];
    taxRate?: number | null;
    taxLabel?: string;
    paymentTermsDays?: number | null;
  },
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const [loaded, booking] = await Promise.all([
    getBillableWorkToInvoice(projectId),
    getBookingConfig(),
  ]);
  if (!loaded) return { ok: false, error: "Project not found." };
  const { work, entries, contractInvoicedUsd } = loaded;
  if (!work.clientId) return { ok: false, error: "Attach a client to this project first." };
  if (work.lines.length === 0) {
    return {
      ok: false,
      error: "Nothing to bill yet: every completed piece of work and logged hour is on an invoice already.",
    };
  }
  const picked = options?.lines ? new Set(options.lines) : null;
  const lines = picked ? work.lines.filter((line) => picked.has(line.key)) : work.lines;
  if (picked?.size === 0) return { ok: false, error: "Tick at least one line to bill." };
  // A ticked line that isn't billable any more was billed from another tab.
  if (picked && lines.length < picked.size) {
    return {
      ok: false,
      error: "Some of this work was just billed on another invoice. Reload the page to see what's left.",
    };
  }

  const taxRate = options?.taxRate ?? null;
  const totals = invoiceTotals({ items: lines, taxRate });
  const issueDay = todayIn(booking.agencyTimezone);
  const termsDays = options?.paymentTermsDays ?? null;
  const fixedIds = lines.flatMap((line) =>
    line.source === "milestone-fixed" && line.milestoneId ? [line.milestoneId] : [],
  );
  const billsContract = lines.some((line) => line.source === "contract");

  let invoice: { id: string; invoiceNumber: string };
  try {
    invoice = await createWithNextNumber(prisma, (invoiceNumber) =>
      prisma.$transaction(
        async (tx) => {
          // One bill at a time per project: a second click waits here, then
          // finds its work already billed below instead of billing it again.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bill-work:${projectId}`}))`;
          if (fixedIds.length > 0) {
            const taken = await tx.invoiceItem.count({
              where: { milestoneId: { in: fixedIds }, invoice: { status: { not: "CANCELLED" } } },
            });
            if (taken > 0) throw new BilledMeanwhile();
          }
          if (billsContract) {
            const now = contractInvoiced(
              (
                await tx.invoice.findMany({
                  where: { projectId, status: { not: "CANCELLED" } },
                  select: contractInvoiceSelect,
                })
              ).map(toContractInvoice),
            );
            if (now.usd !== contractInvoicedUsd) throw new BilledMeanwhile();
          }

          const created = await tx.invoice.create({
            data: {
              invoiceNumber,
              title: `${work.projectName} — work to date`,
              clientId: work.clientId!,
              projectId: work.projectId,
              amount: totals.total,
              subtotal: totals.subtotal,
              discount: 0,
              taxRate,
              taxLabel: options?.taxLabel || null,
              paymentTermsDays: termsDays,
              status: "DRAFT",
              issueDate: parseDate(issueDay)!,
              dueDate: parseDate(dueDateFromTerms(issueDay, termsDays) ?? ""),
              // Work is priced in dollars, so the draft is worth its own total.
              amountUsd: usdToStore("USD", totals.total, null),
              items: {
                create: lines.map((line, index) => ({
                  description: line.description,
                  qty: line.qty,
                  rate: line.rate,
                  sortOrder: index,
                  milestoneId: line.milestoneId,
                })),
              },
            },
            select: { id: true, invoiceNumber: true, items: { select: { id: true, sortOrder: true } } },
          });

          // The hours rolled into each hourly line point at it. Every one has
          // to be still unbilled, or another invoice got there first.
          for (const [index, line] of lines.entries()) {
            if (line.source !== "milestone-hourly" || !line.milestoneId) continue;
            const ids = entries[line.milestoneId] ?? [];
            const item = created.items.find((i) => i.sortOrder === index);
            if (!item || ids.length === 0) continue;
            const linked = await tx.timeEntry.updateMany({
              where: { id: { in: ids }, ...unbilledHours },
              data: { invoiceItemId: item.id },
            });
            if (linked.count !== ids.length) throw new BilledMeanwhile();
          }
          return { id: created.id, invoiceNumber: created.invoiceNumber };
        },
        { maxWait: 10_000, timeout: 20_000 },
      ),
    );
  } catch (err) {
    if (err instanceof BilledMeanwhile) {
      return {
        ok: false,
        error: "Some of this work was just billed on another invoice. Reload the page to see what's left.",
      };
    }
    throw err;
  }

  after(() =>
    logActivity({
      type: "invoice.drafted",
      summary: `Invoice ${invoice.invoiceNumber} drafted from work on ${work.projectName}`,
      clientId: work.clientId,
      projectId: work.projectId,
      entity: "invoice",
      entityId: invoice.id,
      link: invoiceLink(invoice.id),
    }),
  );

  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/admin");
  return { ok: true, data: { id: invoice.id } };
}

/**
 * Record money received. Several payments can land against one invoice, so a
 * deposit no longer forces a choice between "unpaid" and "paid".
 */
export async function recordPayment(
  invoiceId: string,
  input: { amount: number; paidAt: string; method?: string; note?: string },
): Promise<ActionResult> {
  await requireAdmin();
  const amount = cents(Number(input.amount));
  if (!(amount > 0)) return { ok: false, error: "Enter an amount above zero." };

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: moneySelect,
  });
  if (!invoice) return { ok: false, error: "Invoice not found." };
  const blocked = paymentBlocker(invoice);
  if (blocked) return { ok: false, error: blocked };

  await addPayment(invoice, {
    amount,
    paidAt: parseDate(input.paidAt) ?? new Date(),
    method: input.method?.trim().slice(0, 100) || null,
    note: input.note?.trim().slice(0, 500) || null,
  });

  after(() =>
    logActivity({
      type: "invoice.payment",
      summary: `Payment recorded on ${invoice.invoiceNumber} · ${formatCurrency(amount, invoice.currency)}`,
      clientId: invoice.clientId,
      projectId: invoice.projectId,
      entity: "invoice",
      entityId: invoice.id,
      link: invoiceLink(invoice.id),
    }),
  );
  revalidateInvoice(invoiceId);
  return { ok: true };
}

/**
 * Remove a payment recorded by mistake. The status settles back to where the
 * remaining money puts it, and no further: it used to be forced to SENT,
 * which overwrote a cancelled invoice, a draft, or one the client had just
 * said they paid.
 */
export async function deletePayment(paymentId: string): Promise<ActionResult> {
  await requireAdmin();
  const payment = await prisma.invoicePayment.findUnique({
    where: { id: paymentId },
    select: { id: true, amount: true, invoice: { select: moneySelect } },
  });
  if (!payment) return { ok: false, error: "Payment not found." };

  const { invoice } = payment;
  const amount = Number(payment.amount);
  const paidBefore = Number(invoice.amountPaid);
  const expected = cents(Math.max(paidBefore - amount, 0));
  const status = settledStatus(invoice, { paid: expected });
  const [, saved] = await prisma.$transaction([
    prisma.invoicePayment.delete({ where: { id: paymentId } }),
    prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        // Decremented in place, like recordPayment increments. A total that
        // was never in step with its payment rows bottoms out at zero.
        amountPaid: paidBefore >= amount ? { decrement: amount } : 0,
        status,
      },
      select: { amountPaid: true },
    }),
  ]);
  await settleIfRaced(invoice, Number(saved.amountPaid), expected, status);

  revalidateInvoice(invoice.id);
  return { ok: true };
}

/**
 * Issue a credit note against an invoice — a separate document carrying the
 * credited amount, linked back to the original. Cancelling an invoice outright
 * would lose the paper trail.
 *
 * The credit counts toward settling the original (settleStatus), so crediting
 * the rest of a part-paid invoice marks it paid, and the chaser and the
 * balances stop asking for money that was written off. Its USD value is the
 * same share of the original's, when that is known.
 */
export async function createCreditNote(
  invoiceId: string,
  input: { amount: number; reason?: string },
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const amount = cents(Number(input.amount));
  if (!(amount > 0)) return { ok: false, error: "Enter an amount above zero." };

  const source = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: moneySelect,
  });
  if (!source) return { ok: false, error: "Invoice not found." };
  if (source.creditNoteForId) return { ok: false, error: "A credit note can't itself be credited." };
  if (source.status === "CANCELLED") {
    return { ok: false, error: "This invoice is cancelled, so there's nothing to credit." };
  }
  if (source.status === "DRAFT") {
    return { ok: false, error: "This invoice is still a draft. Edit it instead of crediting it." };
  }

  const total = Number(source.amount);
  const credited = creditedTotal(source.creditNotes);
  const room = cents(total - credited);
  if (amount > room) {
    return {
      ok: false,
      error:
        room > 0
          ? `A credit note can't take the invoice below zero. ${formatCurrency(room, source.currency)} is left to credit.`
          : "This invoice has already been credited in full.",
    };
  }

  const reason = input.reason?.trim().slice(0, 300) || null;
  // Pro rata from the original's settled USD value, so a EUR credit note isn't
  // left needing a value of its own; usdToStore covers a USD original without one.
  const amountUsd =
    source.amountUsd != null && total > 0
      ? cents((Number(source.amountUsd) * amount) / total)
      : usdToStore(source.currency, amount, null);
  const parentStatus = settledStatus(source, { credited: cents(credited + amount) });

  const note = await createWithNextNumber(
    prisma,
    async (invoiceNumber) => {
      const [created] = await prisma.$transaction([
        prisma.invoice.create({
          data: {
            invoiceNumber,
            title: `Credit note for ${source.invoiceNumber}`,
            clientId: source.clientId,
            projectId: source.projectId,
            currency: source.currency,
            creditNoteForId: source.id,
            amount,
            subtotal: amount,
            amountUsd,
            status: "SENT",
            issueDate: new Date(),
            notes: reason,
            items: {
              create: [
                {
                  description: `Credit against ${source.invoiceNumber}${reason ? ` — ${reason}` : ""}`,
                  qty: 1,
                  rate: amount,
                  sortOrder: 0,
                },
              ],
            },
          },
          select: { id: true, invoiceNumber: true },
        }),
        prisma.invoice.update({ where: { id: source.id }, data: { status: parentStatus } }),
      ]);
      return created;
    },
    // Same number as the invoice series, under its own prefix.
    (number) => `CN-${number.replace(/^INV-/, "")}`,
  );

  after(() =>
    logActivity({
      type: "invoice.credited",
      summary: `Credit note ${note.invoiceNumber} issued against ${source.invoiceNumber} · ${formatCurrency(amount, source.currency)}`,
      clientId: source.clientId,
      projectId: source.projectId,
      entity: "invoice",
      entityId: note.id,
      link: invoiceLink(note.id),
    }),
  );
  revalidateInvoice(invoiceId);
  return { ok: true, data: { id: note.id } };
}

/**
 * The owner checked and the payment the client reported hasn't arrived:
 * clear the claim. A claimed invoice is never chased, so without this one
 * mistaken "I've paid" silenced its reminders for good. An invoice that was
 * In review because of the claim goes back to where its money puts it, and
 * the client can report the payment again.
 */
export async function clearPaymentClaim(id: string): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await prisma.invoice.findUnique({ where: { id }, select: moneySelect });
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (!invoice.paymentClaimedAt && invoice.status !== "IN_REVIEW") return { ok: true };

  const status =
    invoice.status === "IN_REVIEW"
      ? settledStatus(invoice, { status: invoice.sentAt ? "SENT" : "ASSIGNED" })
      : invoice.status;
  await prisma.invoice.update({ where: { id }, data: { paymentClaimedAt: null, status } });

  after(() =>
    logActivity({
      type: "invoice.claim_cleared",
      summary: `Payment on ${invoice.invoiceNumber} not received — the client's claim was cleared`,
      clientId: invoice.clientId,
      projectId: invoice.projectId,
      entity: "invoice",
      entityId: invoice.id,
      link: invoiceLink(invoice.id),
    }),
  );
  revalidateInvoice(id);
  return { ok: true };
}

/**
 * The invoice page's "Pause reminders": the chaser skips a paused invoice
 * entirely, before and after its due date, until it is resumed.
 */
export async function setInvoiceReminders(id: string, paused: boolean): Promise<ActionResult> {
  await requireAdmin();
  const updated = await prisma.invoice.updateMany({
    where: { id },
    data: { remindersPaused: paused },
  });
  if (updated.count === 0) return { ok: false, error: "Invoice not found." };
  revalidatePath(invoiceLink(id));
  return { ok: true };
}

/**
 * Void an invoice: CANCELLED keeps its number, its payments and its history,
 * and it stops counting as owed. This is what an issued invoice gets instead
 * of a delete.
 */
export async function cancelInvoice(id: string): Promise<ActionResult> {
  return setInvoiceStatus(id, "CANCELLED");
}

/**
 * Delete outright — only an invoice nobody was sent and no money touched
 * (canDeleteInvoice). It used to delete anything, taking the payments, the
 * tasks and the number of a paid invoice with it.
 */
export async function deleteInvoice(id: string): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      sentAt: true,
      amountPaid: true,
      pdfPath: true,
      paymentClaimedAt: true,
      creditNoteForId: true,
      retainerId: true,
      _count: { select: { payments: true, creditNotes: true } },
      retainerTemplateFor: {
        select: { id: true, title: true, _count: { select: { invoices: true } } },
      },
    },
  });
  if (!invoice) return { ok: false, error: "Invoice not found." };
  const deletable = canDeleteInvoice({
    status: invoice.status,
    sentAt: invoice.sentAt,
    paymentClaimedAt: invoice.paymentClaimedAt,
    amountPaid: Number(invoice.amountPaid),
    paymentCount: invoice._count.payments,
    creditNoteCount: invoice._count.creditNotes,
  });
  if (!deletable) {
    return {
      ok: false,
      error:
        "This invoice has been sent, paid, credited or reported paid, so it can't be deleted. Cancel it instead: it keeps its number and its history.",
    };
  }

  // A plan copies its template for every new period. A plan this invoice
  // started (it has no other invoices) goes with it, as when an invoice made
  // recurring by mistake is deleted; one with a history needs a new template
  // first, rather than quietly falling back to a single line.
  const plans = invoice.retainerTemplateFor;
  const kept = plans.find(
    (p) => p._count.invoices > (invoice.retainerId === p.id ? 1 : 0),
  );
  if (kept) {
    return {
      ok: false,
      error: `This invoice is the template for the recurring plan “${kept.title}”. Use another of its invoices as the template, or delete the plan, first.`,
    };
  }

  if (plans.length > 0) {
    await prisma.$transaction([
      prisma.retainer.deleteMany({ where: { id: { in: plans.map((p) => p.id) } } }),
      prisma.invoice.delete({ where: { id } }),
    ]);
  } else {
    await prisma.invoice.delete({ where: { id } });
  }
  const file = invoice.pdfPath;
  if (file) after(() => deleteUpload("invoices", file));
  await resettleCredited(invoice.creditNoteForId);

  revalidatePath("/admin/invoices");
  revalidatePath("/admin");
  if (plans.length > 0 || invoice.retainerId) revalidatePath("/admin/retainers");
  return { ok: true };
}
