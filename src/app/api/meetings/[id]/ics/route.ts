import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { icsFile } from "@/lib/calendar-links";
import { verifyMeetingIcsToken } from "@/lib/marketing-token";

/**
 * Downloads a meeting as .ics. Access: admin (any meeting), the meeting's
 * client (session), or anyone holding the signed token from the email.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get("token");
  const session = await getSession();
  const user = session?.user;

  const tokenOk = token ? verifyMeetingIcsToken(id, token) : false;
  const sessionOk = !!user && user.status !== "INACTIVE";
  if (!tokenOk && !sessionOk) return new NextResponse(null, { status: 401 });

  const meeting = await prisma.meeting.findFirst({
    where:
      tokenOk || user?.role === "ADMIN" ? { id } : { id, clientId: user!.id },
  });
  if (!meeting) return new NextResponse(null, { status: 404 });

  return new NextResponse(icsFile(meeting), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="avix-meeting-${meeting.id.slice(0, 8)}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
