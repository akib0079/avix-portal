import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Health check + keep-alive. An external monitor (e.g. UptimeRobot) pings
 * this every few minutes, which (a) alerts on downtime and (b) keeps the
 * database active so free-tier hosts never pause it for inactivity.
 * No auth: it reveals nothing but liveness and database round-trip time.
 */
export async function GET() {
  try {
    // Round-trip time to the database, as the app sees it. Every query a page
    // makes pays this at least once, so it is the number that says whether
    // the app server and the database are too far apart.
    const started = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbMs = Math.round(performance.now() - started);
    return NextResponse.json(
      { ok: true, dbMs },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
