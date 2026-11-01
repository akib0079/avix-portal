import "server-only";
import { readFile } from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { invoiceTotals } from "@/lib/invoice-totals";
import { getBranding, getInvoiceFooter } from "@/lib/dal/settings";
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
 * Logos, read once per process. Every PDF used to read the logo off disk (or
 * out of the storage bucket) again. An uploaded logo is keyed by its file
 * name, and a new upload gets a new name, so a changed logo is never served
 * stale. A failed read is not kept, so the next PDF tries again.
 */
const logoCache = new Map<string, Promise<string | null>>();

function cachedLogo(key: string, load: () => Promise<string | null>): Promise<string | null> {
  let pending = logoCache.get(key);
  if (!pending) {
    pending = load().then((uri) => {
      if (!uri) logoCache.delete(key);
      return uri;
    });
    logoCache.set(key, pending);
  }
  return pending;
}

/**
 * Logo for the document: the dedicated invoice logo when set, else the bundled
 * dark avixdigital PNG. Deliberately does NOT use the web branding logo — that
 * one is light-on-dark for the app sidebar and prints invisibly on a white
 * invoice. An invoice must never go out unbranded.
 */
async function invoiceLogo(invoiceLogoFile: string | null): Promise<string | null> {
  const uploaded = invoiceLogoFile
    ? await cachedLogo(`upload:${invoiceLogoFile}`, () => imageDataUri(invoiceLogoFile))
    : null;
  if (uploaded) return uploaded;
  return cachedLogo("bundled", async () => {
    try {
      const file = await readFile(path.join(process.cwd(), "public", "avix-logo.png"));
      return `data:image/png;base64,${file.toString("base64")}`;
    } catch {
      return null; // falls back to the text wordmark
    }
  });
}

/** What the document is built from, loaded as one statement. */
export const invoicePdfInclude = {
  items: { orderBy: { sortOrder: "asc" } },
  client: { select: { firstName: true, lastName: true, company: true, email: true } },
  paymentAccount: true,
} satisfies Prisma.InvoiceInclude;

export type InvoicePdfRow = Prisma.InvoiceGetPayload<{ include: typeof invoicePdfInclude }>;

/**
 * Renders the generated invoice PDF from an invoice the caller has already
 * loaded (with invoicePdfInclude) and authorized. Sending uses this so the
 * invoice it emails is read once, not once for the email and again here.
 */
export async function renderInvoicePdfFor(invoice: InvoicePdfRow): Promise<Buffer> {
  const [branding, footer] = await Promise.all([getBranding(), getInvoiceFooter()]);

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
      // Without this the document never sees the formatting and silently falls
      // back to the plain-text convention — bullets typed in the editor simply
      // did not appear on the PDF.
      descriptionRich: i.descriptionRich,
      qty: Number(i.qty),
      rate: Number(i.rate),
    })),
    subtotal: invoice.subtotal == null ? null : Number(invoice.subtotal),
    discount: Number(invoice.discount ?? 0),
    taxLabel: invoice.taxLabel,
    taxRate: invoice.taxRate == null ? null : Number(invoice.taxRate),
    // Recomputed rather than stored, so the document can never disagree with
    // the rate and discount printed beside it.
    taxAmount: invoiceTotals({
      items: invoice.items.map((i) => ({ qty: Number(i.qty), rate: Number(i.rate) })),
      amount: Number(invoice.amount),
      discount: Number(invoice.discount ?? 0),
      taxRate: invoice.taxRate == null ? null : Number(invoice.taxRate),
    }).taxAmount,
    amountPaid: Number(invoice.amountPaid ?? 0),
    total: Number(invoice.amount),
    client: {
      name: `${invoice.client.firstName} ${invoice.client.lastName}`.trim(),
      // Per-invoice company override falls back to the client's own company.
      company: invoice.billToCompany || invoice.client.company,
      email: invoice.client.email,
      address: invoice.billToAddress,
      extraEmail: invoice.billToEmail,
    },
    footer: footer.trim() || null,
    branding: {
      color: branding.color || "#F65D0B",
      logoDataUri: await invoiceLogo(branding.invoiceLogoFile),
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

/**
 * Renders the generated invoice PDF for an id. `scope` narrows the lookup —
 * the download route passes the client's id and "not a draft" here, so the
 * ownership check and the read are one query instead of two. With no scope it
 * is UNSCOPED, and the caller must have authorized already. Returns null when
 * nothing matches.
 */
export async function renderInvoicePdfById(
  id: string,
  scope: Prisma.InvoiceWhereInput = {},
): Promise<{ pdf: Buffer; invoiceNumber: string } | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { ...scope, id },
    include: invoicePdfInclude,
  });
  if (!invoice) return null;
  return { pdf: await renderInvoicePdfFor(invoice), invoiceNumber: invoice.invoiceNumber };
}
