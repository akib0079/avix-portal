import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  currentWorkViewer,
  getBoard,
  getBoardPeople,
  getWorkItems,
  getWorkVersion,
} from "@/lib/dal/project-board";

/**
 * The Milestones tab's poll. Same access rule as the page: the team sees any
 * project's work, a client only their own (anything else reads as 404, not
 * 403, so the endpoint can't be used to probe which project ids exist).
 *
 * One statement answers both "may you?" and "has anything changed?" (see
 * getWorkVersion). When the caller's ?v= still matches, the answer is 204
 * with no body, so a quiet board costs one round trip and no payload.
 *
 * ?archived=1 lists the project's archive instead (the team only), for the
 * list's "Show archived".
 *
 * ?for=accept|new-task is a dialog opened away from the project page (My
 * Work, the Requests inbox, chat) filling its pickers: just the people and
 * the phases, in one wave with the access check, not the whole board.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [{ id }, viewer] = await Promise.all([params, currentWorkViewer()]);
  if (!viewer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const headers = { "Cache-Control": "no-store" };
  const query = new URL(request.url).searchParams;
  if (query.get("archived") === "1") {
    // The team may read any project's archive, so there is nothing to check
    // first: an unknown id is simply an empty list. One round trip.
    if (viewer.role === "CLIENT") return NextResponse.json({ error: "Not found" }, { status: 404 });
    const items = await getWorkItems(id, viewer, { archived: true });
    return NextResponse.json({ items }, { headers });
  }

  const purpose = query.get("for");
  if (purpose === "accept" || purpose === "new-task") {
    const clientId = viewer.role === "CLIENT" ? viewer.id : null;
    const [allowed, people, phases] = await Promise.all([
      clientId ? prisma.project.count({ where: { id, clientId } }) : 1,
      // Checks nothing itself: it's thrown away below unless the check passes.
      getBoardPeople(id),
      // The phases as phasesOf picks them: live, accepted, top level, in plan order.
      prisma.milestone.findMany({
        where: {
          projectId: id,
          archivedAt: null,
          parentId: null,
          stage: { not: "REQUESTED" },
          ...(clientId ? { project: { clientId } } : {}),
        },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        take: 500,
        select: { id: true, title: true },
      }),
    ]);
    if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ people, phases }, { headers });
  }

  const version = await getWorkVersion(id, viewer);
  if (!version) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (query.get("v") === version) return new NextResponse(null, { status: 204, headers });

  const board = await getBoard(id, viewer, version);
  return NextResponse.json(board, { headers });
}
