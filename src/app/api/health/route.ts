import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Health check + keep-alive. An external monitor (e.g. UptimeRobot) pings
 * this every few minutes, which (a) alerts on downtime and (b) keeps the
 * database active so free-tier hosts never pause it for inactivity.
 * No auth: it reveals nothing but liveness.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
