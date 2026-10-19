import { NextResponse } from "next/server";
import { boardAccess, getBoard } from "@/lib/dal/project-board";

/**
 * The board's poll. Same access rule as the page: the team sees any project's
 * board, a client only their own (anything else reads as 404, not 403, so the
 * endpoint can't be used to probe which project ids exist).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await boardAccess(id);
  if (!viewer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const board = await getBoard(viewer.project.id);
  return NextResponse.json(board, { headers: { "Cache-Control": "no-store" } });
}
