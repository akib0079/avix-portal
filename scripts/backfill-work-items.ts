/**
 * Runs the v49 work-item backfill pass (src/lib/work-backfill.ts) by hand and
 * prints how many rows each step touched. It is the pass the app runs on every
 * boot: what an older build wrote since the last pass, and nothing before it.
 *
 *   npx tsx --env-file=.env scripts/backfill-work-items.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { backfillWorkItemsOnBoot } from "../src/lib/work-backfill";

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

backfillWorkItemsOnBoot(prisma)
  .then((counts) => console.log(`rows touched per step: ${counts.join(", ")}`))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
