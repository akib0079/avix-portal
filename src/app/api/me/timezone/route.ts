import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { parseBrowserTimezone } from "@/lib/browser-timezone";
import { prisma } from "@/lib/prisma";

/**
 * Records the client's browser timezone (TimezoneSync), so the admin can see
 * their local time. A route handler, not a server action: an action's
 * response refreshes the router, and this write changes nothing on screen.
 * Only fills when EMPTY — an admin's manual edit is never overwritten.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "CLIENT" || session.user.status !== "ACTIVE") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // JSON only: a cross-site form can't send it without a preflight.
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
  }
  const body: unknown = await request.json().catch(() => null);
  const tz = parseBrowserTimezone((body as { timezone?: unknown } | null)?.timezone);
  if (!tz) return NextResponse.json({ error: "Invalid timezone." }, { status: 400 });

  await prisma.user.updateMany({
    where: { id: session.user.id, timezone: null },
    data: { timezone: tz },
  });
  return NextResponse.json({ ok: true });
}
