"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { invoiceSchema } from "@/lib/validation/invoice";
import { nextInvoiceNumber } from "@/lib/invoice-number";
import { saveUpload, deleteUpload } from "@/lib/uploads";
import { sendEmail } from "@/lib/email/resend";
import InvoiceSentEmail from "@/emails/invoice-sent";
import { usd } from "@/lib/format";
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
  const raw = {
    clientId: String(formData.get("clientId") ?? ""),
    projectId: String(formData.get("projectId") ?? "none"),
    amount: Number(formData.get("amount")),
    status: String(formData.get("status") ?? "ASSIGNED"),
    issueDate: String(formData.get("issueDate") ?? ""),
    dueDate: String(formData.get("dueDate") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
  return invoiceSchema.safeParse(raw);
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

  const invoice = await prisma.$transaction(async (tx) => {
    const invoiceNumber = await nextInvoiceNumber(tx);
    return tx.invoice.create({
      data: {
        invoiceNumber,
        clientId: data.clientId,
        projectId: relations.resolvedProjectId,
        amount: data.amount,
        status: data.status,
        issueDate: parseDate(data.issueDate)!,
        dueDate: parseDate(data.dueDate),
        notes: data.notes || null,
        pdfPath: pdf.fileName,
        pdfOriginalName: pdf.originalName,
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

  await prisma.invoice.update({
    where: { id },
    data: {
      clientId: data.clientId,
      projectId: relations.resolvedProjectId,
      amount: data.amount,
      status: data.status,
      issueDate: parseDate(data.issueDate)!,
      dueDate: parseDate(data.dueDate),
      notes: data.notes || null,
      ...(pdf.fileName
        ? { pdfPath: pdf.fileName, pdfOriginalName: pdf.originalName }
        : {}),
    },
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

  const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/invoices`;
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
      />
    ),
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
        link: "/portal/invoices",
      },
    }),
  ]);

  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${id}`);
  return { ok: true };
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
