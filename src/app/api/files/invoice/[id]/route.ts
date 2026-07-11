import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { openUpload } from "@/lib/uploads";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || session.user.status === "INACTIVE") {
    return new NextResponse(null, { status: 401 });
  }

  const { id } = await params;
  const viewer = session.user;

  // Admins can fetch any invoice; clients only their own. findFirst + 404
  // avoids revealing whether an invoice id exists.
  const invoice = await prisma.invoice.findFirst({
    where: viewer.role === "ADMIN" ? { id } : { id, clientId: viewer.id },
    select: {
      pdfPath: true,
      pdfOriginalName: true,
      pdfExternalUrl: true,
      invoiceNumber: true,
    },
  });
  if (!invoice) return new NextResponse(null, { status: 404 });

  // An external file link (Drive/Dropbox) takes precedence over an upload.
  if (invoice.pdfExternalUrl) {
    return NextResponse.redirect(invoice.pdfExternalUrl, 302);
  }
  if (!invoice.pdfPath) return new NextResponse(null, { status: 404 });

  const data = await openUpload("invoices", invoice.pdfPath);
  if (!data) return new NextResponse(null, { status: 404 });

  const downloadName = invoice.pdfOriginalName ?? `${invoice.invoiceNumber}.pdf`;
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${downloadName.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
