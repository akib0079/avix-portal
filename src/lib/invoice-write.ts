import "server-only";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { usdToStore } from "@/lib/invoice-usd";
import { createWithNextNumber } from "@/lib/invoice-number";
import {
  balanceDue,
  creditedTotal,
  dueDateFromTerms,
  invoiceTotals,
  settleStatus,
  unsettledStatus,
} from "@/lib/invoice-totals";
import { draftBlocker } from "@/lib/invoice-rules";
import type { InvoiceInput } from "@/lib/validation/invoice";

/**
 * How an invoice is written, shared by the admin's actions and the duties
 * engine (a recurring plan creates its invoices with the same rules the form
 * does). NO AUTHORIZATION HERE: every caller checks first. Deliberately not a
 * "use server" module, whose every export would be callable from a browser.
 */

export function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Items win over the manual amount, then discount and tax are applied — the
 * stored `amount` is always the grand total the client owes.
 */
export function totalsFor(data: {
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

export function itemRows(
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

/**
 * Rewrites saved lines of one invoice in place (text, formatting, amounts,
 * position), however many, in one statement: an UPDATE per line cost a
 * round trip each, which on a long Bill work invoice took seconds.
 */
export function updateLines(
  db: Prisma.TransactionClient,
  invoiceId: string,
  lines: ({ id: string } & ReturnType<typeof itemRows>[number])[],
) {
  // One JSON parameter. A line with no formatting comes out NULL, and reads back null.
  return db.$executeRaw`
    UPDATE "invoice_items" AS i
    SET "description" = v."description",
        "descriptionRich" = v."descriptionRich",
        "qty" = v."qty",
        "rate" = v."rate",
        "sortOrder" = v."sortOrder"
    FROM jsonb_to_recordset(${JSON.stringify(lines)}::jsonb) AS v(
      "id" text, "description" text, "descriptionRich" jsonb,
      "qty" numeric, "rate" numeric, "sortOrder" int
    )
    WHERE i."id" = v."id" AND i."invoiceId" = ${invoiceId}`;
}

/** What a save resolved from the form before writing anything. */
export type Refs = {
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
export async function resolveRefs(
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
          where: {
            id: data.projectId,
            OR: [
              { clientId: data.clientId },
              { clientId: null },
              // An edit may keep the project it already had, even if that
              // project has since moved to another client.
              ...(selfId ? [{ invoices: { some: { id: selfId, clientId: data.clientId } } }] : []),
            ],
          },
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
export function formColumns(data: InvoiceInput, refs: Refs) {
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
export const moneySelect = {
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

export type MoneyRow = Prisma.InvoiceGetPayload<{ select: typeof moneySelect }>;

/** Rounded to cents, the way the Decimal columns store it. */
export function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The method on the payment "Mark paid" records for a balance nobody entered. */
export const MARKED_PAID = "Marked paid";

/** settleStatus for a loaded invoice, given whichever figures are changing. */
export function settledStatus(
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
 * an invoice the client already has, and cancelling one would show it to them,
 * so a draft is deleted instead. Anything else settles against what has
 * been paid and credited, so editing the amount of a paid invoice upward turns
 * it back into part paid instead of leaving it PAID with money owing.
 *
 * A claim the owner moves back to Sent is a claim they rejected: it is cleared
 * so reminders resume and the client can report the payment again.
 */
export function formStatus(
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
  // The client sees every invoice but a draft, a cancelled one included, so
  // cancelling one that was never issued would publish it to them.
  if (requested === "CANCELLED" && (!invoice || invoice.status === "DRAFT")) {
    return {
      error: invoice
        ? "This draft was never sent, so there's nothing to cancel. Delete it, or leave it as a draft: the client can't see it."
        : "A new invoice can't start cancelled. Save it as a draft instead: the client can't see a draft.",
    };
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
export async function addPayment(
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
export async function settleIfRaced(
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

/** A cancelled invoice's work, billed again on these live invoices. */
class Rebilled extends Error {
  constructor(readonly invoiceNumbers: string[]) {
    super("Rebilled");
  }
}

/**
 * Brings a cancelled invoice back with `write`, unless its work was billed
 * again meanwhile. Cancelling frees the work an invoice bills, so Bill work
 * can put the same fixed piece of work on a new invoice and move the hours
 * onto it; restoring the old one as well bills that work twice.
 *
 * `write` runs under the Bill work lock of every project whose work the
 * invoice's lines bill, so no bill lands in between, and it is rolled back if
 * another live invoice now bills one of those lines' work: a fixed line's, or
 * an hourly line's whose hours have moved. An hourly line that still has its
 * hours is left alone, since later hours of the same work are rightly on
 * other invoices. Returns those invoices' numbers; none when it was restored.
 */
export async function restoreCancelled(
  invoiceId: string,
  write: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<string[]> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext('bill-work:' || w."projectId"))
          FROM (
            SELECT DISTINCT m."projectId" FROM "invoice_items" AS ii
            JOIN "milestones" AS m ON m."id" = ii."milestoneId"
            WHERE ii."invoiceId" = ${invoiceId}
            ORDER BY 1
          ) AS w`;
        await write(tx);
        // Read after the write, so lines the same edit removed don't count.
        const taken = await tx.invoice.findMany({
          where: {
            id: { not: invoiceId },
            status: { not: "CANCELLED" },
            items: {
              some: {
                milestone: { invoiceItems: { some: { invoiceId, timeEntries: { none: {} } } } },
              },
            },
          },
          orderBy: { invoiceNumber: "asc" },
          select: { invoiceNumber: true },
        });
        if (taken.length > 0) throw new Rebilled(taken.map((t) => t.invoiceNumber));
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
    return [];
  } catch (err) {
    if (err instanceof Rebilled) return err.invoiceNumbers;
    throw err;
  }
}

export type PreparedInvoice = {
  data: InvoiceInput;
  refs: Refs;
  columns: ReturnType<typeof formColumns>;
  status: InvoiceStatus;
  /** A balance recorded as paid on creation ("Paid" chosen for a new invoice). */
  markPaid: number;
};

/**
 * Everything a new invoice is checked against before anything is stored:
 * its client, project, number, payment account and source, and the status
 * its money allows. The caller stores an uploaded PDF only after this, so a
 * rejected save never strands a file.
 */
export async function prepareInvoice(
  data: InvoiceInput,
): Promise<{ ok: true; prepared: PreparedInvoice } | { ok: false; error: string }> {
  const refs = await resolveRefs(data);
  if ("error" in refs) return { ok: false, error: refs.error };
  const columns = formColumns(data, refs);
  const next = formStatus(null, data.status, columns.amount);
  if ("error" in next) return { ok: false, error: next.error };
  return {
    ok: true,
    prepared: { data, refs, columns, status: next.status, markPaid: next.markPaid },
  };
}

/**
 * A recurring plan created together with its first invoice, which becomes
 * its template (the Repeat section of a new invoice).
 */
export type PlanSeed = Omit<
  Prisma.RetainerUncheckedCreateWithoutInvoicesInput,
  "id" | "templateInvoiceId"
>;

/**
 * Creates a prepared invoice: one nested create, lines included, under the
 * custom number or the next free one. (It used to be an interactive
 * transaction holding a connection open across every statement.) `extra`
 * carries what the form doesn't: an uploaded file, or a plan and its period.
 *
 * With a `plan`, the plan is created in the same transaction and copies
 * this invoice for every new period: either both exist or neither does.
 */
export async function createPreparedInvoice(
  { data, refs, columns, status, markPaid }: PreparedInvoice,
  extra: Pick<
    Prisma.InvoiceUncheckedCreateInput,
    "pdfPath" | "pdfOriginalName" | "retainerId" | "retainerPeriod"
  > = {},
  plan?: PlanSeed,
): Promise<{ id: string; invoiceNumber: string; retainerId: string | null }> {
  const row = (invoiceNumber: string) => ({
    invoiceNumber,
    ...columns,
    ...extra,
    duplicatedFromId: refs.duplicatedFromId,
    status,
    // Created as already paid: the payment it stands for is on the record.
    ...(markPaid > 0
      ? {
          amountPaid: markPaid,
          payments: {
            create: [{ amount: markPaid, paidAt: new Date(), method: MARKED_PAID }],
          },
        }
      : {}),
    items: { create: itemRows(data.items) },
  });
  const select = { id: true, invoiceNumber: true, retainerId: true } as const;
  const create = plan
    ? (invoiceNumber: string) =>
        prisma.$transaction(
          async (tx) => {
            const invoice = await tx.invoice.create({ data: row(invoiceNumber), select });
            // The plan points at its template, so it is made once the
            // invoice has an id, through the invoice, which joins it.
            return tx.invoice.update({
              where: { id: invoice.id },
              data: { retainer: { create: { ...plan, templateInvoiceId: invoice.id } } },
              select,
            });
          },
          { maxWait: 10_000, timeout: 20_000 },
        )
    : (invoiceNumber: string) => prisma.invoice.create({ data: row(invoiceNumber), select });
  return refs.customNumber ? create(refs.customNumber) : createWithNextNumber(prisma, create);
}
