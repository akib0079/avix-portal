import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { getThreadMessages } from "@/lib/dal/messages";

/**
 * Polls one thread. A thread is (clientId, projectId); no projectId means the
 * client's general thread. Clients may only ever read their own threads —
 * their clientId comes from the session, never the query string.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.user.status === "INACTIVE") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = session.user;
  const params = new URL(request.url).searchParams;
  const projectId = params.get("projectId");

  const isTeam = user.role === "ADMIN" || user.role === "STAFF";
  const clientId = isTeam ? params.get("clientId") : user.id;
  if (!clientId) {
    return NextResponse.json({ error: "Missing clientId" }, { status: 400 });
  }

  // A project thread must belong to that client (blocks cross-client reads).
  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, clientId },
      select: { id: true },
    });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const key = { clientId, projectId: projectId ?? null };
  const messages = await getThreadMessages(key);

  // Mark the other side's messages as read for this viewer.
  const field = isTeam ? "readByAdminAt" : "readByClientAt";
  await prisma.message.updateMany({
    where: { ...key, [field]: null },
    data: { [field]: new Date() },
  });

  return NextResponse.json({ messages });
}
