import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { openUpload, contentTypeFor } from "@/lib/uploads";

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

  // Admins can fetch any deliverable; clients only those on their own projects.
  // findFirst + 404 avoids revealing whether an id exists.
  const deliverable = await prisma.deliverable.findFirst({
    where:
      viewer.role === "ADMIN"
        ? { id }
        : { id, project: { clientId: viewer.id } },
    select: {
      filePath: true,
      fileOriginalName: true,
      externalUrl: true,
      title: true,
    },
  });
  if (!deliverable) return new NextResponse(null, { status: 404 });

  // An external link takes precedence over an upload.
  if (deliverable.externalUrl) {
    return NextResponse.redirect(deliverable.externalUrl, 302);
  }
  if (!deliverable.filePath) return new NextResponse(null, { status: 404 });

  const data = await openUpload("deliverables", deliverable.filePath);
  if (!data) return new NextResponse(null, { status: 404 });

  const downloadName = deliverable.fileOriginalName ?? deliverable.title;
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentTypeFor(deliverable.filePath),
      "Content-Disposition": `attachment; filename="${downloadName.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
