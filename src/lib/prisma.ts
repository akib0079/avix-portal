import { applyPersistentEnv, getPersistentSecrets } from "@/lib/load-persistent-env";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Uses the pure-JS pg driver adapter instead of Prisma's native Rust engine —
 * the native binary panics on restricted shared-hosting runtimes (observed as
 * PrismaClientRustPanicError on Hostinger web apps). Supabase poolers require
 * TLS; local/docker Postgres doesn't, so SSL is enabled by host detection.
 *
 * The connection string is resolved from the persistent secrets file FIRST
 * (durable across redeploys, immune to the host's stale env), then process.env.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  // Apply secrets over process.env for other consumers, and read the DB URL
  // straight from the file so nothing about import ordering can let a stale
  // value win.
  applyPersistentEnv();
  const secrets = getPersistentSecrets();
  const connectionString = secrets.DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  const needsSsl = /supabase\.(co|com)/i.test(connectionString);
  const adapter = new PrismaPg(
    {
      connectionString,
      // Queries beyond this wait for a free connection, so a page firing 20 in
      // parallel runs them in waves. Kept at 5 because Hostinger runs several
      // Node processes, each with its own pool, against Supabase's session
      // pooler limit. Raise DB_POOL_MAX only once that headroom is known.
      max: Number(process.env.DB_POOL_MAX) || 5,
      // Keep connections open. pg-pool's default closes them after 10 s idle,
      // and with the database in Tokyo and the app in Manchester a reconnect
      // (TCP + TLS + auth) costs ~1.6 s: the first click after any pause paid
      // it, and so did every 15-30 s poll. min stops the pool reaping below
      // two; keepAlive stops middleboxes silently dropping idle sockets.
      min: Number(process.env.DB_POOL_MIN) || 2,
      idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_MS) || 300_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    },
    {
      // A server-side close of an idle connection removes it from the pool;
      // log it rather than let it go unnoticed.
      onPoolError: (err) => console.warn("[db] idle connection dropped:", err.message),
    },
  );
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

// One client per process in every environment. The production build places
// this module in more than one chunk (pages, route handlers, instrumentation);
// without the global each copy opened its own pool, so polls warmed a pool the
// pages never used and the connection count multiplied.
globalForPrisma.prisma = prisma;
