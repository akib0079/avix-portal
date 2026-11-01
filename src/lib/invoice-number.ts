import "server-only";
import { Prisma } from "@prisma/client";

/** Race-safe sequential invoice numbers: INV-001, INV-002, … */
export async function nextInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const counter = await tx.counter.upsert({
    where: { name: "invoice" },
    update: { value: { increment: 1 } },
    create: { name: "invoice", value: 1 },
  });
  return `INV-${String(counter.value).padStart(3, "0")}`;
}

/**
 * Creates a row under the next free invoice number.
 *
 * The counter only knows the numbers it handed out, but the form also takes
 * custom ones, so "INV-025" typed by hand last month is waiting for the
 * counter when it gets to 25. The unique index then rejects the insert; the
 * next number is taken instead of failing the save. A skipped number is
 * harmless, a lost invoice is not.
 *
 * The counter is bumped outside any transaction on purpose: a create that
 * fails for another reason leaves a gap rather than holding a transaction
 * open across round trips to the database.
 */
export async function createWithNextNumber<T>(
  db: Prisma.TransactionClient,
  create: (invoiceNumber: string) => Promise<T>,
  /** Derive the stored number, e.g. INV-018 → CN-018 for a credit note. */
  format: (invoiceNumber: string) => string = (number) => number,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const invoiceNumber = format(await nextInvoiceNumber(db));
    try {
      return await create(invoiceNumber);
    } catch (err) {
      if (attempt < 4 && isNumberTaken(err)) continue;
      throw err;
    }
  }
}

function isNumberTaken(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    JSON.stringify(err.meta ?? {}).includes("invoiceNumber")
  );
}
