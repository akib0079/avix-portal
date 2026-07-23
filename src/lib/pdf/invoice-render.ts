import "server-only";
import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getBranding } from "@/lib/dal/settings";
import { openUpload } from "@/lib/uploads";
import { renderInvoicePdf, type InvoicePdfData } from "@/lib/pdf/invoice-pdf";

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** Branding image as a data URI. react-pdf rasterizes PNG/JPG only. */
async function imageDataUri(fileName: string | null): Promise<string | null> {
  if (!fileName || !/\.(png|jpe?g)$/i.test(fileName)) return null;
  const data = await openUpload("branding", fileName);
  if (!data) return null;
  const mime = /\.png$/i.test(fileName) ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${data.toString("base64")}`;
}

/**
 * Logo for the document: the uploaded branding logo when embeddable, else the
 * bundled avixdigital PNG. The uploaded logo is commonly SVG/WebP (great on the
 * web, unusable in a PDF), and an invoice must never go out unbranded.
 */
async function invoiceLogo(brandLogoFile: string | null): Promise<string | null> {
  const uploaded = await imageDataUri(brandLogoFile);
  if (uploaded) return uploaded;
  try {
    const file = await readFile(path.join(process.cwd(), "public", "avix-logo.png"));
    return `data:image/png;base64,${file.toString("base64")}`;
  } catch {
    return null; // falls back to the text wordmark
  }
}

/**
 * Renders the generated invoice PDF for an id. UNSCOPED — callers (the download
 * route, the send-invoice action) authorize first. Returns null if the invoice
 * is gone.
 */
export async function renderInvoicePdfById(id: string): Promise<Buffer | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      client: { select: { firstName: true, lastName: true, company: true, email: true } },
      paymentAccount: true,
    },
  });
  if (!invoice) return null;

  const branding = await getBranding();

  const data: InvoicePdfData = {
    invoiceNumber: invoice.invoiceNumber,
    title: invoice.title,
    currency: invoice.currency,
    status: invoice.status,
    issueDate: fmtDate(invoice.issueDate),
    dueDate: invoice.dueDate ? fmtDate(invoice.dueDate) : null,
    notes: invoice.notes,
    items: invoice.items.map((i) => ({
      description: i.description,
      qty: Number(i.qty),
      rate: Number(i.rate),
    })),
    total: Number(invoice.amount),
    client: {
      name: `${invoice.client.firstName} ${invoice.client.lastName}`.trim(),
      company: invoice.client.company,
      email: invoice.client.email,
    },
    branding: {
      color: branding.color || "#F65D0B",
      logoDataUri: await invoiceLogo(branding.logoFile),
    },
    bankAccount: invoice.paymentAccount
      ? {
          holderName: invoice.paymentAccount.holderName,
          bankName: invoice.paymentAccount.bankName,
          fields: invoice.paymentAccount.fields as { label: string; value: string }[],
        }
      : null,
  };

  return renderInvoicePdf(data);
}
