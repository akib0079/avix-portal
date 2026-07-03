import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Uses the pure-JS pg driver adapter instead of Prisma's native Rust engine —
 * the native binary panics on restricted shared-hosting runtimes (observed as
 * PrismaClientRustPanicError on Hostinger web apps). Supabase poolers require
 * TLS; local/docker Postgres doesn't, so SSL is enabled by host detection.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL ?? "";
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
