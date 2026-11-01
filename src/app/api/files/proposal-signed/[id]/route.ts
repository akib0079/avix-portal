import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { readProposalLink } from "@/lib/marketing-token";
import { signedPdfFileName, signedProposalPdf } from "@/lib/pdf/proposal-render";

/**
 * The signed proposal PDF. Three ways in, each checked before anything is
 * read or rendered:
 *  - ?token=… — the proposal's link, as long as it is the current version.
 *    Its expiry doesn't matter here: a signed proposal stays readable to the
 *    person who signed it, as the public page does.
 *  - an admin session;
 *  - the client the proposal was accepted for (convertedClientId).
 * STAFF never: the document carries every price. Anything else is a 404, so
 * the route says nothing about which proposals exist.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get("token");
  // The link's signature is checked before anything is read; a bad or old
  // one still leaves the session to speak for the viewer.
  const claims = token && token.length <= 256 ? readProposalLink(id, token) : null;

  const [proposal, session] = await Promise.all([
    prisma.proposal.findUnique({
      where: { id },
      select: {
        title: true,
        status: true,
        linkVersion: true,
        convertedClientId: true,
        signatures: {
          where: { role: "CLIENT" },
          orderBy: { signedAt: "desc" },
          take: 1,
          select: { id: true, pdfPath: true },
        },
      },
    }),
    getSession(),
  ]);
  const signature = proposal?.signatures[0];
  if (!proposal || proposal.status !== "ACCEPTED" || !signature) {
    return new NextResponse(null, { status: 404 });
  }

  const viewer = session?.user;
  const allowed =
    (claims != null && claims.version === proposal.linkVersion) ||
    (viewer != null &&
      viewer.status !== "INACTIVE" &&
      (viewer.role === "ADMIN" || (viewer.role === "CLIENT" && viewer.id === proposal.convertedClientId)));
  if (!allowed) return new NextResponse(null, { status: 404 });

  const pdf = await signedProposalPdf(signature);
  if (!pdf) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${signedPdfFileName(proposal.title)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // The link's token is in this URL; nothing it leads to should see it.
      "Referrer-Policy": "no-referrer",
    },
  });
}
