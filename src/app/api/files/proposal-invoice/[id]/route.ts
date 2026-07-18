import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { openUpload } from "@/lib/uploads";

/**
 * The invoice document attached to a proposal, so the admin can check what
 * they attached before it's sent. ADMIN-only: a proposal isn't a client
 * document yet, and it carries pricing. After acceptance the same file is
 * reachable to the client through /api/files/invoice/[id].
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin();

  const { id } = await params;
  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: {
      invoicePdfPath: true,
      invoicePdfOriginalName: true,
      invoicePdfExternalUrl: true,
      title: true,
    },
  });
  if (!proposal) return new NextResponse(null, { status: 404 });

  // An external link (Drive/Dropbox) takes precedence over an upload.
  if (proposal.invoicePdfExternalUrl) {
    return NextResponse.redirect(proposal.invoicePdfExternalUrl, 302);
  }
  if (!proposal.invoicePdfPath) return new NextResponse(null, { status: 404 });

  const data = await openUpload("invoices", proposal.invoicePdfPath);
  if (!data) return new NextResponse(null, { status: 404 });

  const downloadName = proposal.invoicePdfOriginalName ?? `${proposal.title}.pdf`;
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${downloadName.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
