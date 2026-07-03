import { NextResponse } from "next/server";
import { Client } from "pg";
import { timingSafeEqual } from "crypto";

/**
 * TEMPORARY deployment-debugging endpoint. Tests a candidate database
 * password against the configured host from inside the production network.
 * Protected by BETTER_AUTH_SECRET; accepts credentials only via POST body
 * (never query strings, never logged). Remove after the deployment is fixed.
 */

function authorized(token: string | undefined): boolean {
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  if (!token || !secret || token.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    token?: string;
    password?: string;
    host?: string;
    port?: number;
    user?: string;
  } | null;

  if (!body || !authorized(body.token)) {
    return new NextResponse(null, { status: 404 });
  }

  const base = new URL(process.env.DATABASE_URL ?? "postgresql://x:x@localhost:5432/postgres");
  const client = new Client({
    host: body.host ?? base.hostname,
    port: body.port ?? Number(base.port || 5432),
    user: body.user ?? decodeURIComponent(base.username),
    password: body.password ?? decodeURIComponent(base.password),
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });

  try {
    await client.connect();
    const res = await client.query(
      "SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema='public'",
    );
    await client.end();
    return NextResponse.json({ ok: true, tables: res.rows[0].tables });
  } catch (err) {
    await client.end().catch(() => {});
    return NextResponse.json({
      ok: false,
      error: (err as Error).message.slice(0, 200),
    });
  }
}
