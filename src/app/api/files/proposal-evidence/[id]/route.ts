import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { contentTypeFor, openUpload } from "@/lib/uploads";

/**
 * The proof attached when the admin recorded an acceptance by hand (an email
 * saved as PDF, a screenshot). ADMIN-only: it is the agency's own record, and
 * may show anything the client wrote. The file is named on the proposal's
 * SIGNED event, which is where the recording keeps it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const event = await prisma.proposalEvent.findFirst({
    where: { proposalId: id, type: "SIGNED" },
    orderBy: { createdAt: "desc" },
    select: { meta: true },
  });
  const meta =
    event?.meta && typeof event.meta === "object" && !Array.isArray(event.meta)
      ? (event.meta as Record<string, unknown>)
      : null;
  const fileName = typeof meta?.evidenceFile === "string" ? meta.evidenceFile : null;
  if (!fileName) return new NextResponse(null, { status: 404 });

  const data = await openUpload("contracts", fileName);
  if (!data) return new NextResponse(null, { status: 404 });

  const original = typeof meta?.evidenceName === "string" ? meta.evidenceName : fileName;
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentTypeFor(fileName),
      "Content-Disposition": `attachment; filename="${original.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
