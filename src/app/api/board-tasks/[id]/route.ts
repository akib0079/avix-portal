import { NextResponse } from "next/server";
import { taskAccess, getBoardTaskDetail } from "@/lib/dal/project-board";

/** One card for the detail drawer: description and comment thread. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await taskAccess(id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const detail = await getBoardTaskDetail(access.task.id);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
}
