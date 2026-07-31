"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { invoiceSchema } from "@/lib/validation/invoice";
import { nextInvoiceNumber } from "@/lib/invoice-number";
import { invoiceTotals, dueDateFromTerms } from "@/lib/invoice-totals";
import { getBillableWork } from "@/lib/dal/billable";
import { saveUpload, deleteUpload } from "@/lib/uploads";
import { sendEmail } from "@/lib/email/resend";
import InvoiceSentEmail from "@/emails/invoice-sent";
import { renderInvoicePdfById } from "@/lib/pdf/invoice-render";
import { logActivity } from "@/lib/dal/activity";
import { usd } from "@/lib/format";
import { appUrl } from "@/lib/app-url";
import type { InvoiceStatus } from "@prisma/client";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function extractFields(formData: FormData) {
  // Line items travel as one JSON field (FormData is flat). Invalid JSON is
  // treated as "no items" and the amount field governs, exactly as before.
  let items: unknown;
  const rawItems = formData.get("items");
  if (typeof rawItems === "string" && rawItems) {
    try {
      items = JSON.parse(rawItems);
    } catch {
      items = undefined;
    }
  }
  const amountRaw = Number(formData.get("amount"));
  const raw = {
    items,
    clientId: String(formData.get("clientId") ?? ""),
    projectId: String(formData.get("projectId") ?? "none"),
    // NaN (empty field while using line items) → 0; superRefine rejects 0
    // only when there are no items.
    amount: Number.isNaN(amountRaw) ? 0 : amountRaw,
    status: String(formData.get("status") ?? "ASSIGNED"),
    issueDate: String(formData.get("issueDate") ?? ""),
    dueDate: String(formData.get("dueDate") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    pdfExternalUrl: String(formData.get("pdfExternalUrl") ?? ""),
    invoiceNumber: String(formData.get("invoiceNumber") ?? ""),
    title: String(formData.get("title") ?? ""),
    currency: String(formData.get("currency") ?? "USD"),
    paymentAccountId: String(formData.get("paymentAccountId") ?? ""),
    billToCompany: String(formData.get("billToCompany") ?? ""),
    billToAddress: String(formData.get("billToAddress") ?? ""),
    billToEmail: String(formData.get("billToEmail") ?? ""),
  };
  return invoiceSchema.safeParse(raw);
}

/** "none"/empty → null; else the id (validated against active accounts). */
async function resolvePaymentAccountId(value: string | undefined): Promise<string | null> {
  if (!value || value === "none") return null;
  const account = await prisma.paymentAccount.findUnique({
    where: { id: value },
    select: { id: true },
  });
  return account?.id ?? null;
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

function itemRows(items: { description: string; qty: number; rate: number }[] | undefined) {
  return (items ?? []).map((i, index) => ({
    description: i.description,
    qty: i.qty,
    rate: i.rate,
    sortOrder: index,
  }));
}

async function validateRelations(clientId: string, projectId: string) {
  const client = await prisma.user.findFirst({
    where: { id: clientId, role: "CLIENT" },
    select: { id: true },
  });
  if (!client) return { error: "Selected client not found." };

  let resolvedProjectId: string | null = null;
  if (projectId !== "none") {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) return { error: "Selected project not found." };
    resolvedProjectId = project.id;
  }
  return { resolvedProjectId };
}

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
  const parsed = extractFields(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const relations = await validateRelations(data.clientId, data.projectId);
  if ("error" in relations) return { ok: false, error: relations.error! };

  const pdf = await handlePdf(formData);
  if (!pdf.ok) return { ok: false, error: pdf.error };
  const paymentAccountId = await resolvePaymentAccountId(data.paymentAccountId);

  // Custom number if given (must be unique); otherwise auto-assign.
  const custom = data.invoiceNumber?.trim();
  if (custom) {
    const clash = await prisma.invoice.findUnique({
      where: { invoiceNumber: custom },
      select: { id: true },
    });
    if (clash) return { ok: false, error: `Invoice number "${custom}" is already used.` };
  }

  const invoice = await prisma.$transaction(async (tx) => {
    const invoiceNumber = custom || (await nextInvoiceNumber(tx));
    const totals = totalsFor(data);
    return tx.invoice.create({
      data: {
        invoiceNumber,
        clientId: data.clientId,
        projectId: relations.resolvedProjectId,
        amount: totals.total,
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxRate: data.taxRate ?? null,
        taxLabel: data.taxLabel || null,
        paymentTermsDays: data.paymentTermsDays ?? null,
        status: data.status,
        issueDate: parseDate(data.issueDate)!,
        dueDate: parseDate(
          data.dueDate || dueDateFromTerms(data.issueDate, data.paymentTermsDays) || "",
        ),
        notes: data.notes || null,
        title: data.title || null,
        currency: data.currency ?? "USD",
        billToCompany: data.billToCompany || null,
        billToAddress: data.billToAddress || null,
        billToEmail: data.billToEmail || null,
        paymentAccountId,
        pdfPath: pdf.fileName,
        pdfOriginalName: pdf.originalName,
        pdfExternalUrl: data.pdfExternalUrl || null,
        items: { create: itemRows(data.items) },
      },
    });
  });

  revalidatePath("/admin/invoices");
  revalidatePath("/admin");
  return { ok: true, data: { id: invoice.id } };
}

export async function updateInvoice(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = extractFields(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) return { ok: false, error: "Invoice not found." };

  const relations = await validateRelations(data.clientId, data.projectId);
  if ("error" in relations) return { ok: false, error: relations.error! };

  const pdf = await handlePdf(formData);
  if (!pdf.ok) return { ok: false, error: pdf.error };

  // Replacing the PDF? Clean up the old file.
  if (pdf.fileName && invoice.pdfPath) {
    await deleteUpload("invoices", invoice.pdfPath);
  }
  const paymentAccountId = await resolvePaymentAccountId(data.paymentAccountId);

  // Allow renaming the invoice number; keep it unique.
  const custom = data.invoiceNumber?.trim();
  const nextNumber = custom || invoice.invoiceNumber;
  if (nextNumber !== invoice.invoiceNumber) {
    const clash = await prisma.invoice.findFirst({
      where: { invoiceNumber: nextNumber, id: { not: id } },
      select: { id: true },
    });
    if (clash) return { ok: false, error: `Invoice number "${nextNumber}" is already used.` };
  }

  const totals = totalsFor(data);
  await prisma.$transaction(async (tx) => {
    await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
    await tx.invoice.update({
      where: { id },
      data: {
        invoiceNumber: nextNumber,
        clientId: data.clientId,
        projectId: relations.resolvedProjectId,
        amount: totals.total,
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxRate: data.taxRate ?? null,
        taxLabel: data.taxLabel || null,
        paymentTermsDays: data.paymentTermsDays ?? null,
        status: data.status,
        issueDate: parseDate(data.issueDate)!,
        dueDate: parseDate(
          data.dueDate || dueDateFromTerms(data.issueDate, data.paymentTermsDays) || "",
        ),
        notes: data.notes || null,
        title: data.title || null,
        currency: data.currency ?? "USD",
        billToCompany: data.billToCompany || null,
        billToAddress: data.billToAddress || null,
        billToEmail: data.billToEmail || null,
        paymentAccountId,
        pdfExternalUrl: data.pdfExternalUrl || null,
        ...(pdf.fileName
          ? { pdfPath: pdf.fileName, pdfOriginalName: pdf.originalName }
          : {}),
        items: { create: itemRows(data.items) },
      },
    });
  });

  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${id}`);
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
      summary: `Invoice ${invoice.invoiceNumber} marked paid · ${usd.format(Number(invoice.amount))}`,
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
        amount={usd.format(Number(invoice.amount))}
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
        body: `${usd.format(Number(invoice.amount))}${invoice.project ? ` · ${invoice.project.projectName}` : ""}`,
        link: `/portal/invoices/${invoice.id}`,
      },
    }),
  ]);

  await logActivity({
    type: "invoice.sent",
    summary: `Invoice ${invoice.invoiceNumber} sent · ${usd.format(Number(invoice.amount))}`,
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
    select: { id: true, amount: true, invoiceNumber: true, clientId: true, projectId: true },
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
    summary: `Payment recorded on ${invoice.invoiceNumber} · ${usd.format(input.amount)}`,
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
