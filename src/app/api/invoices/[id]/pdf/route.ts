import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { getBranding, listActivePaymentAccounts } from "@/lib/dal/settings";
import { openUpload } from "@/lib/uploads";
import { renderInvoicePdf, type InvoicePdfData } from "@/lib/pdf/invoice-pdf";

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** Branding image as a data URI, PNG/JPG only (react-pdf can't rasterize SVG). */
async function imageDataUri(fileName: string | null): Promise<string | null> {
  if (!fileName || !/\.(png|jpg)$/i.test(fileName)) return null;
  const data = await openUpload("branding", fileName);
  if (!data) return null;
  const mime = /\.png$/i.test(fileName) ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${data.toString("base64")}`;
}

/**
 * The GENERATED invoice document — built on demand from line items, branding
 * and payment accounts. Independent of any uploaded/linked PDF (that one is
 * served by /api/files/invoice/[id]). Same auth model: admin any, client own,
 * everyone else 404 via findFirst scoping (no id-existence oracle).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || session.user.status === "INACTIVE") {
    return new NextResponse(null, { status: 401 });
  }
  const viewer = session.user;
  // STAFF are money-blind — invoices are admin/client-owner only.
  if (viewer.role !== "ADMIN" && viewer.role !== "CLIENT") {
    return new NextResponse(null, { status: 404 });
  }

  const { id } = await params;
  const invoice = await prisma.invoice.findFirst({
    where: viewer.role === "ADMIN" ? { id } : { id, clientId: viewer.id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      client: { select: { firstName: true, lastName: true, company: true, email: true } },
    },
  });
  if (!invoice) return new NextResponse(null, { status: 404 });

  const [branding, accounts] = await Promise.all([
    getBranding(),
    listActivePaymentAccounts(),
  ]);

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
      logoDataUri: await imageDataUri(branding.logoFile),
      signatureDataUri: await imageDataUri(branding.signatureFile),
    },
    // One account per invoice — the one matching its currency (EUR → SEPA,
    // USD → ACH), else the first active. Printing all of them overflows the
    // page and asks the client to pick, which invites wrong transfers.
    bankAccounts: (() => {
      const preferred = invoice.currency === "EUR" ? "EU_SEPA" : "US_ACH";
      const chosen =
        accounts.find((a) => a.region === preferred) ?? accounts[0] ?? null;
      return chosen
        ? [
            {
              title: chosen.title,
              holderName: chosen.holderName,
              bankName: chosen.bankName,
              fields: chosen.fields,
            },
          ]
        : [];
    })(),
  };

  const pdf = await renderInvoicePdf(data);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
