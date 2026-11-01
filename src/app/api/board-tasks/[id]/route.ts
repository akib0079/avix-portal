import { NextResponse } from "next/server";
import { getWorkItemDetail } from "@/lib/dal/project-board";

/**
 * One work item for the drawer: description, thread, recent hours and the
 * request it came from. Scoped to the session inside the read; an item the
 * viewer may not see reads as 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getWorkItemDetail(id);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
}
