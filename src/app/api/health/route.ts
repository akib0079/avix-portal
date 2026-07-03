import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Health check + keep-alive. An external monitor (e.g. UptimeRobot) pings
 * this every few minutes, which (a) alerts on downtime and (b) keeps the
 * database active so free-tier hosts never pause it for inactivity.
 * On failure it reports sanitized diagnostics (booleans and error codes
 * only — never values), so platform issues are debuggable from outside.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const e = err as { code?: string; name?: string; message?: string };
    return NextResponse.json(
      {
        ok: false,
        code: e.code ?? e.name ?? "unknown",
        hint: (e.message ?? "").split("\n").pop()?.slice(0, 160) ?? null,
        env: {
          DATABASE_URL: Boolean(process.env.DATABASE_URL),
          DIRECT_URL: Boolean(process.env.DIRECT_URL),
          BETTER_AUTH_SECRET: Boolean(process.env.BETTER_AUTH_SECRET),
          SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
