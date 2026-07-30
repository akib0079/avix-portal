/**
 * One-off: fill Message.bodyText for rows written before the column existed.
 * Safe to re-run — it only touches rows where bodyText is still null.
 *
 *   npx tsx scripts/backfill-message-text.ts
 */
import { PrismaClient } from "@prisma/client";
import { richTextToPlain } from "../src/lib/rich-text";

const prisma = new PrismaClient();
const BATCH = 200;

async function main() {
  let done = 0;
  for (;;) {
    const rows = await prisma.message.findMany({
      where: { bodyText: null },
      select: { id: true, body: true },
      take: BATCH,
    });
    if (rows.length === 0) break;

    await Promise.all(
      rows.map((row) =>
        prisma.message.update({
          where: { id: row.id },
          data: { bodyText: richTextToPlain(row.body) },
        }),
      ),
    );
    done += rows.length;
    console.log(`backfilled ${done}`);
  }
  console.log(`done — ${done} message(s) updated`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
