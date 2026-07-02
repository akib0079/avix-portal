import "server-only";
import type { Prisma } from "@prisma/client";

/** Race-safe sequential invoice numbers: INV-001, INV-002, … */
export async function nextInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const counter = await tx.counter.upsert({
    where: { name: "invoice" },
    update: { value: { increment: 1 } },
    create: { name: "invoice", value: 1 },
  });
  return `INV-${String(counter.value).padStart(3, "0")}`;
}
