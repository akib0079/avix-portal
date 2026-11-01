"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { usdToStore } from "@/lib/invoice-usd";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { parseInvoiceForm } from "@/lib/invoice-form-data";
import { createWithNextNumber, nextInvoiceNumber } from "@/lib/invoice-number";
import { invoiceTotals, dueDateFromTerms } from "@/lib/invoice-totals";
import { getBillableWork } from "@/lib/dal/billable";
import { saveUpload, deleteUpload } from "@/lib/uploads";
import { sendEmail } from "@/lib/email/resend";
import InvoiceSentEmail from "@/emails/invoice-sent";
import { renderInvoicePdfById } from "@/lib/pdf/invoice-render";
import { logActivity } from "@/lib/dal/activity";
import { formatCurrency } from "@/lib/currency";
import { appUrl } from "@/lib/app-url";
import type { InvoiceStatus } from "@prisma/client";
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
  const [client, project, clash, account] = await Promise.all([
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
    pdfExternalUrl: data.pdfExternalUrl || null,
  };
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

  const pdf = await handlePdf(formData);
  if (!pdf.ok) return { ok: false, error: pdf.error };

  // One nested create, lines included, under the custom number or the next
  // free one. This used to be an interactive transaction holding a connection
  // open across every statement.
  const create = (invoiceNumber: string) =>
    prisma.invoice.create({
      data: {
        invoiceNumber,
        ...formColumns(data, refs),
        status: data.status,
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
    prisma.invoice.findUnique({ where: { id }, select: { id: true, pdfPath: true } }),
    resolveRefs(data, id),
  ]);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if ("error" in refs) return { ok: false, error: refs.error };

  const pdf = await handlePdf(formData);
  if (!pdf.ok) return { ok: false, error: pdf.error };

  // Batched rather than interactive: neither write needs the other's result.
  await prisma.$transaction([
    prisma.invoiceItem.deleteMany({ where: { invoiceId: id } }),
    prisma.invoice.update({
      where: { id },
      data: {
        // A blank number field keeps the current number.
        ...(refs.customNumber ? { invoiceNumber: refs.customNumber } : {}),
        ...formColumns(data, refs),
        status: data.status,
        ...(pdf.fileName
          ? { pdfPath: pdf.fileName, pdfOriginalName: pdf.originalName }
          : {}),
        items: { create: itemRows(data.items) },
      },
    }),
  ]);

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

export async function setInvoiceStatus(
  id: string,
  status: InvoiceStatus,
): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) return { ok: false, error: "Invoice not found." };

  await prisma.invoice.update({ where: { id }, data: { status } });
  if (status === "PAID" && invoice.status !== "PAID") {
    await logActivity({
      type: "invoice.paid",
      summary: `Invoice ${invoice.invoiceNumber} marked paid · ${formatCurrency(Number(invoice.amount), invoice.currency)}`,
      clientId: invoice.clientId,
      projectId: invoice.projectId,
      entity: "invoice",
      entityId: invoice.id,
      link: `/admin/invoices/${invoice.id}`,
    });
  }
  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${id}`);
  revalidatePath("/admin");
  return { ok: true };
}

export async function sendInvoice(id: string): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, firstName: true, email: true } },
      project: { select: { projectName: true } },
    },
  });
  if (!invoice) return { ok: false, error: "Invoice not found." };

  const accounts = await prisma.paymentAccount.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  const paymentAccounts = accounts.map((a) => ({
    title: a.title,
    holderName: a.holderName,
    bankName: a.bankName,
    bankNote: a.bankNote,
    fields: (a.fields as { label: string; value: string }[]) ?? [],
  }));

  // Attach the generated PDF unless the admin supplied their own document
  // (an uploaded file or an external link the client opens directly).
  let attachments: { filename: string; content: Buffer }[] | undefined;
  if (!invoice.pdfPath && !invoice.pdfExternalUrl) {
    const pdf = await renderInvoicePdfById(invoice.id);
    if (pdf) attachments = [{ filename: `${invoice.invoiceNumber}.pdf`, content: pdf }];
  }

  const portalUrl = `${appUrl()}/portal/invoices/${invoice.id}`;
  const sent = await sendEmail({
    to: invoice.client.email,
    subject: `Invoice ${invoice.invoiceNumber} from Avix Digital`,
    react: (
      <InvoiceSentEmail
        firstName={invoice.client.firstName || "there"}
        invoiceNumber={invoice.invoiceNumber}
        amount={formatCurrency(Number(invoice.amount), invoice.currency)}
        projectName={invoice.project?.projectName}
        portalUrl={portalUrl}
        paymentAccounts={paymentAccounts}
        pdfAttached={!!attachments}
      />
    ),
    attachments,
    devHint: `invoice ${invoice.invoiceNumber} → ${invoice.client.email}`,
  });
  if (!sent.ok) {
    return { ok: false, error: "Email failed to send — check the Resend configuration." };
  }

  await prisma.$transaction([
    prisma.invoice.update({
      where: { id },
      data: {
        sentAt: new Date(),
        // Don't regress a further-along status back to SENT.
        ...(invoice.status === "ASSIGNED" ? { status: "SENT" } : {}),
      },
    }),
    prisma.notification.create({
      data: {
        userId: invoice.client.id,
        type: "INVOICE_SENT",
        title: `Invoice ${invoice.invoiceNumber} is ready`,
        body: `${formatCurrency(Number(invoice.amount), invoice.currency)}${invoice.project ? ` · ${invoice.project.projectName}` : ""}`,
        link: `/portal/invoices/${invoice.id}`,
      },
    }),
  ]);

  await logActivity({
    type: "invoice.sent",
    summary: `Invoice ${invoice.invoiceNumber} sent · ${formatCurrency(Number(invoice.amount), invoice.currency)}`,
    clientId: invoice.client.id,
    projectId: invoice.projectId,
    entity: "invoice",
    entityId: invoice.id,
    link: `/admin/invoices/${invoice.id}`,
  });

  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${id}`);
  return { ok: true };
}

/**
 * Draft an invoice straight from work that has happened: completed fixed-price
 * milestones and logged hourly time. Creates it as ASSIGNED so it can be
 * reviewed and edited before anything is sent.
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

  const invoice = await prisma.$transaction(async (tx) => {
    const invoiceNumber = await nextInvoiceNumber(tx);
    return tx.invoice.create({
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
        status: "ASSIGNED",
        issueDate,
        dueDate,
        items: {
          create: work.lines.map((line, index) => ({
            description: line.description,
            qty: line.qty,
            rate: line.rate,
            sortOrder: index,
          })),
        },
      },
    });
  });

  await logActivity({
    type: "invoice.drafted",
    summary: `Invoice ${invoice.invoiceNumber} drafted from work on ${work.projectName}`,
    clientId: work.clientId,
    projectId: work.projectId,
    entity: "invoice",
    entityId: invoice.id,
    link: `/admin/invoices/${invoice.id}`,
  });

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
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, amount: true, currency: true, invoiceNumber: true, clientId: true, projectId: true },
  });
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (!(input.amount > 0)) return { ok: false, error: "Enter an amount above zero." };

  const paidAt = parseDate(input.paidAt) ?? new Date();

  await prisma.$transaction(async (tx) => {
    await tx.invoicePayment.create({
      data: {
        invoiceId,
        amount: input.amount,
        paidAt,
        method: input.method?.trim() || null,
        note: input.note?.trim() || null,
      },
    });
    const agg = await tx.invoicePayment.aggregate({
      where: { invoiceId },
      _sum: { amount: true },
    });
    const paid = Number(agg._sum.amount ?? 0);
    const total = Number(invoice.amount);
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: paid,
        // Status follows the money: nothing owing means paid, part means part.
        status: paid >= total ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : undefined,
      },
    });
  });

  await logActivity({
    type: "invoice.payment",
    summary: `Payment recorded on ${invoice.invoiceNumber} · ${formatCurrency(input.amount, invoice.currency)}`,
    clientId: invoice.clientId,
    projectId: invoice.projectId,
    entity: "invoice",
    entityId: invoice.id,
    link: `/admin/invoices/${invoice.id}`,
  });

  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${invoiceId}`);
  revalidatePath("/admin");
  return { ok: true };
}

export async function deletePayment(paymentId: string): Promise<ActionResult> {
  await requireAdmin();
  const payment = await prisma.invoicePayment.findUnique({
    where: { id: paymentId },
    select: { id: true, invoiceId: true },
  });
  if (!payment) return { ok: false, error: "Payment not found." };

  await prisma.$transaction(async (tx) => {
    await tx.invoicePayment.delete({ where: { id: paymentId } });
    const [agg, invoice] = await Promise.all([
      tx.invoicePayment.aggregate({
        where: { invoiceId: payment.invoiceId },
        _sum: { amount: true },
      }),
      tx.invoice.findUnique({
        where: { id: payment.invoiceId },
        select: { amount: true, status: true },
      }),
    ]);
    const paid = Number(agg._sum.amount ?? 0);
    const total = Number(invoice?.amount ?? 0);
    await tx.invoice.update({
      where: { id: payment.invoiceId },
      data: {
        amountPaid: paid,
        status: paid >= total && total > 0 ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "SENT",
      },
    });
  });

  revalidatePath(`/admin/invoices/${payment.invoiceId}`);
  return { ok: true };
}

/**
 * Issue a credit note against an invoice — a separate document carrying the
 * credited amount, linked back to the original. Cancelling an invoice outright
 * would lose the paper trail.
 */
export async function createCreditNote(
  invoiceId: string,
  input: { amount: number; reason?: string },
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const source = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      invoiceNumber: true,
      clientId: true,
      projectId: true,
      currency: true,
      amount: true,
    },
  });
  if (!source) return { ok: false, error: "Invoice not found." };
  if (!(input.amount > 0)) return { ok: false, error: "Enter an amount above zero." };
  if (input.amount > Number(source.amount)) {
    return { ok: false, error: "A credit note can't exceed the invoice total." };
  }

  const note = await prisma.$transaction(async (tx) => {
    const number = await nextInvoiceNumber(tx);
    return tx.invoice.create({
      data: {
        invoiceNumber: `CN-${number.replace(/^INV-/, "")}`,
        title: `Credit note for ${source.invoiceNumber}`,
        clientId: source.clientId,
        projectId: source.projectId,
        currency: source.currency,
        creditNoteForId: source.id,
        amount: input.amount,
        subtotal: input.amount,
        status: "SENT",
        issueDate: new Date(),
        notes: input.reason?.trim() || null,
        items: {
          create: [
            {
              description: `Credit against ${source.invoiceNumber}${input.reason ? ` — ${input.reason}` : ""}`,
              qty: 1,
              rate: input.amount,
              sortOrder: 0,
            },
          ],
        },
      },
    });
  });

  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${invoiceId}`);
  return { ok: true, data: { id: note.id } };
}

export async function deleteInvoice(id: string): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) return { ok: false, error: "Invoice not found." };

  await prisma.invoice.delete({ where: { id } });
  if (invoice.pdfPath) await deleteUpload("invoices", invoice.pdfPath);

  revalidatePath("/admin/invoices");
  revalidatePath("/admin");
  return { ok: true };
}
