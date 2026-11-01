import { NextResponse } from "next/server";
import { currentWorkViewer, getBoard, getWorkItems, getWorkVersion } from "@/lib/dal/project-board";

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
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [{ id }, viewer] = await Promise.all([params, currentWorkViewer()]);
  if (!viewer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const version = await getWorkVersion(id, viewer);
  if (!version) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const headers = { "Cache-Control": "no-store" };
  const query = new URL(request.url).searchParams;
  if (query.get("archived") === "1") {
    if (viewer.role === "CLIENT") return NextResponse.json({ error: "Not found" }, { status: 404 });
    const items = await getWorkItems(id, viewer, { archived: true });
    return NextResponse.json({ items }, { headers });
  }
  if (query.get("v") === version) return new NextResponse(null, { status: 204, headers });

  const board = await getBoard(id, viewer, version);
  return NextResponse.json(board, { headers });
}
