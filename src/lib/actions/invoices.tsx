"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { usdToStore } from "@/lib/invoice-usd";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { parseInvoiceForm } from "@/lib/invoice-form-data";
import { createWithNextNumber } from "@/lib/invoice-number";
import {
  balanceDue,
  creditedTotal,
  dueDateFromTerms,
  invoiceTotals,
  settleStatus,
  unsettledStatus,
} from "@/lib/invoice-totals";
import { canDeleteInvoice, draftBlocker, paymentBlocker } from "@/lib/invoice-rules";
import { getBillableWork } from "@/lib/dal/billable";
import { listInvoiceProjectOptions } from "@/lib/dal/invoices";
import { saveUpload, deleteUpload } from "@/lib/uploads";
import { logActivity } from "@/lib/dal/activity";
import { sendInvoiceCore } from "@/lib/invoice-send";
import { formatCurrency } from "@/lib/currency";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import type { InvoiceInput } from "@/lib/validation/invoice";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Items win over the manual amount, then discount and tax are applied — the
 * stored `amount` is always the grand total the client owes.
 */
function totalsFor(data: {
  amount: number;
  items?: { qty: number; rate: number }[];
  discount?: number;
  taxRate?: number | null;
}) {
  return invoiceTotals({
    items: data.items,
    amount: data.amount,
    discount: data.discount,
    taxRate: data.taxRate,
  });
}

function itemRows(
  items:
    | { description: string; descriptionRich?: unknown; qty: number; rate: number }[]
    | undefined,
) {
  return (items ?? []).map((i, index) => ({
    description: i.description,
    // Prisma treats `undefined` as "leave alone" and `null` as "write null";
    // an item with no formatting must store null, not skip the column.
    descriptionRich: (i.descriptionRich ?? null) as never,
    qty: i.qty,
    rate: i.rate,
    sortOrder: index,
  }));
}

/** What a save resolved from the form before writing anything. */
type Refs = {
  customNumber: string | null;
  issueDate: Date;
  projectId: string | null;
  paymentAccountId: string | null;
  /** A new invoice's source when it was duplicated; null on edits. */
  duplicatedFromId: string | null;
};

/**
 * Everything a save has to check before it writes, in one wave. None of these
 * lookups depends on another, and they used to run one after the other at
 * ~228 ms apiece against the production database.
 *
 * The project has to be the client's own (or have no client): the portal
 * prints the project's name beside the invoice, so linking one client's
 * invoice to another client's project would show them its name.
 */
async function resolveRefs(
  data: InvoiceInput,
  selfId?: string,
): Promise<Refs | { error: string }> {
  const customNumber = data.invoiceNumber?.trim() || null;
  const accountId =
    data.paymentAccountId && data.paymentAccountId !== "none" ? data.paymentAccountId : null;
  // Provenance is set once, when a copy is created; an edit never moves it.
  const sourceId = !selfId && data.duplicatedFromId ? data.duplicatedFromId : null;
  const [client, project, clash, account, source] = await Promise.all([
    prisma.user.findFirst({
      where: { id: data.clientId, role: "CLIENT" },
      select: { id: true },
    }),
    data.projectId === "none"
      ? null
      : prisma.project.findFirst({
          where: { id: data.projectId, OR: [{ clientId: data.clientId }, { clientId: null }] },
          select: { id: true },
        }),
    // Checked before any PDF is stored: a duplicate number is an ordinary
    // typo, and storing first would strand the upload with no row pointing
    // at it.
    customNumber
      ? prisma.invoice.findFirst({
          where: { invoiceNumber: customNumber, ...(selfId ? { id: { not: selfId } } : {}) },
          select: { id: true },
        })
      : null,
    // An account deleted since the form loaded just prints no bank details.
    accountId
      ? prisma.paymentAccount.findUnique({ where: { id: accountId }, select: { id: true } })
      : null,
    // A source deleted meanwhile (or a credit note, which is never copied)
    // just leaves the copy without a "Copied from" line.
    sourceId
      ? prisma.invoice.findFirst({
          where: { id: sourceId, creditNoteForId: null },
          select: { id: true },
        })
      : null,
  ]);
  if (!client) return { error: "Selected client not found." };
  if (data.projectId !== "none" && !project) {
    return { error: "Selected project not found for this client." };
  }
  if (clash) return { error: `Invoice number "${customNumber}" is already used.` };
  const issueDate = parseDate(data.issueDate);
  if (!issueDate) return { error: "Enter a valid issue date." };
  return {
    customNumber,
    issueDate,
    projectId: project?.id ?? null,
    paymentAccountId: account?.id ?? null,
    duplicatedFromId: source?.id ?? null,
  };
}

/** The columns a form save writes, the same for a new invoice and an edit. */
function formColumns(data: InvoiceInput, refs: Refs) {
  const totals = totalsFor(data);
  const currency = data.currency ?? "USD";
  return {
    clientId: data.clientId,
    projectId: refs.projectId,
    amount: totals.total,
    subtotal: totals.subtotal,
    discount: totals.discount,
    taxRate: data.taxRate ?? null,
    taxLabel: data.taxLabel || null,
    paymentTermsDays: data.paymentTermsDays ?? null,
    issueDate: refs.issueDate,
    dueDate: parseDate(
      data.dueDate || dueDateFromTerms(data.issueDate, data.paymentTermsDays) || "",
    ),
    notes: data.notes || null,
    title: data.title || null,
    currency,
    amountUsd: usdToStore(currency, totals.total, data.amountUsd),
    billToCompany: data.billToCompany || null,
    billToAddress: data.billToAddress || null,
    billToEmail: data.billToEmail || null,
    paymentAccountId: refs.paymentAccountId,
    payLinkUrl: data.payLinkUrl || null,
    pdfExternalUrl: data.pdfExternalUrl || null,
  };
}

/** The columns every money rule reads: the total, what came in, credits, history. */
const moneySelect = {
  id: true,
  invoiceNumber: true,
  amount: true,
  amountPaid: true,
  amountUsd: true,
  currency: true,
  status: true,
  sentAt: true,
  paymentClaimedAt: true,
  creditNoteForId: true,
  clientId: true,
  projectId: true,
  creditNotes: { select: { amount: true, status: true } },
} satisfies Prisma.InvoiceSelect;

type MoneyRow = Prisma.InvoiceGetPayload<{ select: typeof moneySelect }>;

/** Rounded to cents, the way the Decimal columns store it. */
function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The method on the payment "Mark paid" records for a balance nobody entered. */
const MARKED_PAID = "Marked paid";

/** settleStatus for a loaded invoice, given whichever figures are changing. */
function settledStatus(
  invoice: MoneyRow,
  change: { total?: number; paid?: number; credited?: number; status?: InvoiceStatus } = {},
): InvoiceStatus {
  return settleStatus({
    total: change.total ?? Number(invoice.amount),
    paid: change.paid ?? Number(invoice.amountPaid),
    credited: change.credited ?? creditedTotal(invoice.creditNotes),
    current: change.status ?? invoice.status,
    fallback: unsettledStatus(invoice),
  });
}

/**
 * The status a form save writes. The form's status select says what the owner
 * means; the payments say what happened. PAID with a balance left records that
 * balance as a payment, so amountPaid agrees with the badge. A draft can't hide
 * an invoice the client already has. Anything else settles against what has
 * been paid and credited, so editing the amount of a paid invoice upward turns
 * it back into part paid instead of leaving it PAID with money owing.
 *
 * A claim the owner moves back to Sent is a claim they rejected: it is cleared
 * so reminders resume and the client can report the payment again.
 */
function formStatus(
  invoice: MoneyRow | null,
  requested: InvoiceStatus,
  total: number,
): { status: InvoiceStatus; markPaid: number; clearClaim: boolean } | { error: string } {
  const paid = invoice ? Number(invoice.amountPaid) : 0;
  const credited = invoice ? creditedTotal(invoice.creditNotes) : 0;

  if (requested === "DRAFT" && invoice && invoice.status !== "DRAFT") {
    if (invoice.creditNoteForId) return { error: "A credit note can't be a draft." };
    if (invoice.creditNotes.length > 0) {
      return { error: "This invoice has credit notes against it, so it can't go back to being a draft." };
    }
    const blocked = draftBlocker({ sentAt: invoice.sentAt, amountPaid: paid });
    if (blocked) return { error: blocked };
  }
  if (requested === "PAID" && !invoice?.creditNoteForId) {
    const balance = balanceDue(total, paid, credited);
    if (balance > 0) return { status: "PAID", markPaid: balance, clearClaim: false };
  }
  const status = settleStatus({
    total,
    paid,
    credited,
    current: requested,
    fallback: invoice ? unsettledStatus(invoice) : "ASSIGNED",
  });
  const clearClaim =
    !!invoice?.paymentClaimedAt && (status === "SENT" || status === "ASSIGNED" || status === "DRAFT");
  return { status, markPaid: 0, clearClaim };
}

/**
 * Adds a payment and moves the status with it, in one batched transaction.
 *
 * amountPaid is incremented in the database rather than rewritten from the
 * figure read here, so two payments saved at once can't overwrite each other.
 * The status is worked out from the total this payment should produce; if the
 * total that comes back says another payment landed in between, it is put
 * right. `as` is the status being asked for ("Mark paid" on a draft).
 */
async function addPayment(
  invoice: MoneyRow,
  payment: { amount: number; paidAt: Date; method: string | null; note: string | null },
  as?: InvoiceStatus,
): Promise<void> {
  const expected = cents(Number(invoice.amountPaid) + payment.amount);
  const status = settledStatus(invoice, { paid: expected, status: as });
  const [, saved] = await prisma.$transaction([
    prisma.invoicePayment.create({
      data: { invoiceId: invoice.id, ...payment },
      select: { id: true },
    }),
    prisma.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: { increment: payment.amount }, status },
      select: { amountPaid: true },
    }),
  ]);
  await settleIfRaced(invoice, Number(saved.amountPaid), expected, status);
}

/** Another payment changed amountPaid between our read and our write: re-settle. */
async function settleIfRaced(
  invoice: MoneyRow,
  actual: number,
  expected: number,
  written: InvoiceStatus,
): Promise<void> {
  if (cents(actual) === expected) return;
  const status = settledStatus(invoice, { paid: actual, status: written });
  if (status !== written) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status } });
  }
}

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

export async function createInvoice(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = parseInvoiceForm(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const refs = await resolveRefs(data);
  if ("error" in refs) return { ok: false, error: refs.error };
  const columns = formColumns(data, refs);
  const next = formStatus(null, data.status, columns.amount);
  if ("error" in next) return { ok: false, error: next.error };

  const pdf = await handlePdf(formData);
  if (!pdf.ok) return { ok: false, error: pdf.error };

  // One nested create, lines included, under the custom number or the next
  // free one. This used to be an interactive transaction holding a connection
  // open across every statement.
  const create = (invoiceNumber: string) =>
    prisma.invoice.create({
      data: {
        invoiceNumber,
        ...columns,
        duplicatedFromId: refs.duplicatedFromId,
        status: next.status,
        // Created as already paid: the payment it stands for is on the record.
        ...(next.markPaid > 0
          ? {
              amountPaid: next.markPaid,
              payments: {
                create: [{ amount: next.markPaid, paidAt: new Date(), method: MARKED_PAID }],
              },
            }
          : {}),
        pdfPath: pdf.fileName,
        pdfOriginalName: pdf.originalName,
        items: { create: itemRows(data.items) },
      },
      select: { id: true },
    });
  const invoice = refs.customNumber
    ? await create(refs.customNumber)
    : await createWithNextNumber(prisma, create);

  revalidatePath("/admin/invoices");
  revalidatePath("/admin");
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
    prisma.invoice.findUnique({ where: { id }, select: { ...moneySelect, pdfPath: true } }),
    resolveRefs(data, id),
  ]);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if ("error" in refs) return { ok: false, error: refs.error };
  const columns = formColumns(data, refs);
  const next = formStatus(invoice, data.status, columns.amount);
  if ("error" in next) return { ok: false, error: next.error };

  const pdf = await handlePdf(formData);
  if (!pdf.ok) return { ok: false, error: pdf.error };

  // Batched rather than interactive: none of these writes needs another's
  // result. amountPaid moves in place, as it does for any other payment.
  await prisma.$transaction([
    prisma.invoiceItem.deleteMany({ where: { invoiceId: id } }),
    prisma.invoice.update({
      where: { id },
      data: {
        // A blank number field keeps the current number.
        ...(refs.customNumber ? { invoiceNumber: refs.customNumber } : {}),
        ...columns,
        status: next.status,
        ...(next.markPaid > 0 ? { amountPaid: { increment: next.markPaid } } : {}),
        ...(next.clearClaim ? { paymentClaimedAt: null } : {}),
        ...(pdf.fileName
          ? { pdfPath: pdf.fileName, pdfOriginalName: pdf.originalName }
          : {}),
        items: { create: itemRows(data.items) },
      },
    }),
    ...(next.markPaid > 0
      ? [
          prisma.invoicePayment.create({
            data: { invoiceId: id, amount: next.markPaid, paidAt: new Date(), method: MARKED_PAID },
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

/**
 * Draft an invoice straight from work that has happened: completed fixed-price
 * milestones and logged hourly time. Created as a DRAFT, which the client
 * can't see, so it can be reviewed and edited before anything is sent.
 */
export async function createInvoiceFromWork(
  projectId: string,
  options?: { taxRate?: number | null; taxLabel?: string; paymentTermsDays?: number | null },
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const work = await getBillableWork(projectId);
  if (!work) return { ok: false, error: "Project not found." };
  if (!work.clientId) return { ok: false, error: "Attach a client to this project first." };
  if (work.lines.length === 0) {
    return {
      ok: false,
      error: "Nothing to bill yet — complete a priced milestone or log some hours.",
    };
  }

  const totals = invoiceTotals({
    items: work.lines.map((l) => ({ qty: l.qty, rate: l.rate })),
    taxRate: options?.taxRate ?? null,
  });
  const issueDate = new Date();
  const termsDays = options?.paymentTermsDays ?? null;
  const dueDate =
    termsDays == null
      ? null
      : new Date(issueDate.getTime() + termsDays * 24 * 60 * 60 * 1000);

  const invoice = await createWithNextNumber(prisma, (invoiceNumber) =>
    prisma.invoice.create({
      data: {
        invoiceNumber,
        title: `${work.projectName} — work to date`,
        clientId: work.clientId!,
        projectId: work.projectId,
        amount: totals.total,
        subtotal: totals.subtotal,
        discount: 0,
        taxRate: options?.taxRate ?? null,
        taxLabel: options?.taxLabel || null,
        paymentTermsDays: termsDays,
        status: "DRAFT",
        issueDate,
        dueDate,
        // Work is priced in dollars, so the draft is worth its own total.
        // Leaving this out kept every drafted invoice out of the USD stats.
        amountUsd: usdToStore("USD", totals.total, null),
        items: {
          create: work.lines.map((line, index) => ({
            description: line.description,
            qty: line.qty,
            rate: line.rate,
            sortOrder: index,
          })),
        },
      },
      select: { id: true, invoiceNumber: true },
    }),
  );

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
      creditNoteForId: true,
      _count: { select: { payments: true, creditNotes: true } },
    },
  });
  if (!invoice) return { ok: false, error: "Invoice not found." };
  const deletable = canDeleteInvoice({
    status: invoice.status,
    sentAt: invoice.sentAt,
    amountPaid: Number(invoice.amountPaid),
    paymentCount: invoice._count.payments,
    creditNoteCount: invoice._count.creditNotes,
  });
  if (!deletable) {
    return {
      ok: false,
      error:
        "This invoice has been sent, paid or credited, so it can't be deleted. Cancel it instead: it keeps its number and its history.",
    };
  }

  await prisma.invoice.delete({ where: { id } });
  const file = invoice.pdfPath;
  if (file) after(() => deleteUpload("invoices", file));
  await resettleCredited(invoice.creditNoteForId);

  revalidatePath("/admin/invoices");
  revalidatePath("/admin");
  return { ok: true };
}
