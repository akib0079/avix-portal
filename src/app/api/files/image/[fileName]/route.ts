import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { openUpload } from "@/lib/uploads";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileName: string }> },
) {
  const session = await getSession();
  if (!session || session.user.status === "INACTIVE") {
    return new NextResponse(null, { status: 401 });
  }

  const { fileName } = await params;
  const record = await prisma.imageUpload.findUnique({
    where: { fileName },
    include: { uploader: { select: { id: true, role: true } } },
  });
  if (!record) return new NextResponse(null, { status: 404 });

  // Team (admin/staff) sees everything; users see their own uploads; everyone
  // signed in can view team-authored images (milestone/project/chat content).
  const viewer = session.user;
  const isTeamRole = (role: string) => role === "ADMIN" || role === "STAFF";
  const allowed =
    isTeamRole(viewer.role) ||
    record.uploader.id === viewer.id ||
    isTeamRole(record.uploader.role);
  if (!allowed) return new NextResponse(null, { status: 404 });

  const data = await openUpload("images", fileName);
  if (!data) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": record.mimeType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
