import { NextResponse } from "next/server";
import { Client } from "pg";
import { prisma } from "@/lib/prisma";

/**
 * Health check + keep-alive + sanitized self-diagnostics.
 * On failure it reports the runtime DB configuration (password masked) and
 * the raw driver error, so platform issues are debuggable without shell
 * access. Never exposes secret values.
 */

function maskedDbUrl(): string {
  const url = process.env.DATABASE_URL ?? "(unset)";
  return url.replace(/:\/\/([^:]+):[^@]*@/, "://$1:****@");
}

async function rawPgTest() {
  const connectionString = process.env.DATABASE_URL ?? "";
  const needsSsl = /supabase\.(co|com)/i.test(connectionString);
  const client = new Client({
    connectionString,
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    connectionTimeoutMillis: 8000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    return { ok: true as const };
  } catch (err) {
    await client.end().catch(() => {});
    return { ok: false as const, error: (err as Error).message.slice(0, 250) };
  }
}

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { ok: true, driver: "pg-adapter" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const e = err as { code?: string; name?: string; message?: string };
    const raw = await rawPgTest();
    return NextResponse.json(
      {
        ok: false,
        driver: "pg-adapter",
        code: e.code ?? e.name ?? "unknown",
        prismaError: (e.message ?? "").split("\n").filter(Boolean).pop()?.slice(0, 200) ?? null,
        rawPg: raw,
        dbConfig: maskedDbUrl(),
        env: {
          DATABASE_URL: Boolean(process.env.DATABASE_URL),
          BETTER_AUTH_SECRET: Boolean(process.env.BETTER_AUTH_SECRET),
          SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
