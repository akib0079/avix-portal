import { describe, it, expect, vi } from "vitest";
import { nextInvoiceNumber } from "./invoice-number";
import type { Prisma } from "@prisma/client";

function fakeTx(counterValue: number) {
  return {
    counter: {
      upsert: vi.fn().mockResolvedValue({ value: counterValue }),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("nextInvoiceNumber", () => {
  it("pads under 1000 to 3 digits", async () => {
    expect(await nextInvoiceNumber(fakeTx(1))).toBe("INV-001");
    expect(await nextInvoiceNumber(fakeTx(42))).toBe("INV-042");
  });

  it("does not truncate once the count exceeds 3 digits", async () => {
    expect(await nextInvoiceNumber(fakeTx(1000))).toBe("INV-1000");
  });

  it("increments the shared counter atomically via upsert, not read-then-write", async () => {
    const tx = fakeTx(7);
    await nextInvoiceNumber(tx);
    expect(tx.counter.upsert).toHaveBeenCalledWith({
      where: { name: "invoice" },
      update: { value: { increment: 1 } },
      create: { name: "invoice", value: 1 },
    });
  });
});
