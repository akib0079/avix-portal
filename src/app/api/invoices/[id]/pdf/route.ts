import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { renderInvoicePdfById } from "@/lib/pdf/invoice-render";

/**
 * The GENERATED invoice document — built on demand from line items, branding
 * and the chosen payment account. Independent of any uploaded/linked PDF (that
 * one is served by /api/files/invoice/[id]). Auth: admin any, client own,
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
  // Authorize ownership before rendering (client sees only their own).
  const owned = await prisma.invoice.findFirst({
    where: viewer.role === "ADMIN" ? { id } : { id, clientId: viewer.id },
    select: { id: true, invoiceNumber: true },
  });
  if (!owned) return new NextResponse(null, { status: 404 });

  const pdf = await renderInvoicePdfById(id);
  if (!pdf) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${owned.invoiceNumber}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
