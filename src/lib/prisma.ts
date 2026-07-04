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
  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
