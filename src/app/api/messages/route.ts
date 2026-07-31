import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { getThreadMessages, getThreadMessagesSince } from "@/lib/dal/messages";

/**
 * Reads one thread. A thread is (clientId, projectId); no projectId means the
 * client's general thread. Clients may only ever read their own threads —
 * their clientId comes from the session, never the query string.
 *
 * Read-only on purpose: marking messages read is a separate mutation
 * (markThreadRead) so a poll — or a link prefetch — can't write.
 *
 * Query: `since` returns only newer messages (what the poll uses); `before`
 * pages backwards through history; neither returns the newest page.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.user.status === "INACTIVE") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = session.user;
  const params = new URL(request.url).searchParams;
  const projectId = params.get("projectId");
  const since = params.get("since");
  const before = params.get("before");

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

  if (since) {
    const messages = await getThreadMessagesSince(key, since, {
      includeInternal: isTeam,
    });
    return NextResponse.json({ messages, hasMore: false, incremental: true });
  }

  const page = await getThreadMessages(key, { before, includeInternal: isTeam });
  return NextResponse.json({ ...page, incremental: false });
}
