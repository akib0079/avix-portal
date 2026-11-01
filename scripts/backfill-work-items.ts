/**
 * Runs the v49 work-item backfill (src/lib/work-backfill.ts) by hand and prints
 * how many rows each step touched. The app already runs it once on its first
 * boot after the v49 deploy; this is for checking, or if that pass was missed.
 * Idempotent.
 *
 *   npx tsx --env-file=.env scripts/backfill-work-items.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { backfillWorkItems } from "../src/lib/work-backfill";

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

backfillWorkItems(prisma)
  .then((counts) => console.log(`rows touched per step: ${counts.join(", ")}`))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
