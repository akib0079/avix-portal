"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import {
  paymentAccountSchema,
  type PaymentAccountInput,
} from "@/lib/validation/payment";
import type { Prisma } from "@prisma/client";

export type ActionResult = { ok: true } | { ok: false; error: string };

function normalize(input: PaymentAccountInput) {
  return {
    title: input.title,
    region: input.region,
    holderName: input.holderName,
    bankName: input.bankName,
    bankNote: input.bankNote || null,
    note: input.note || null,
    isActive: input.isActive,
    fields: input.fields as unknown as Prisma.InputJsonValue,
  };
}

export async function createPaymentAccount(
  input: PaymentAccountInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = paymentAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const last = await prisma.paymentAccount.aggregate({ _max: { position: true } });
  await prisma.paymentAccount.create({
    data: { ...normalize(parsed.data), position: (last._max.position ?? -1) + 1 },
  });
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function updatePaymentAccount(
  id: string,
  input: PaymentAccountInput,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = paymentAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const existing = await prisma.paymentAccount.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Payment account not found." };
  await prisma.paymentAccount.update({
    where: { id },
    data: normalize(parsed.data),
  });
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function deletePaymentAccount(id: string): Promise<ActionResult> {
  await requireAdmin();
  const existing = await prisma.paymentAccount.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Payment account not found." };
  await prisma.paymentAccount.delete({ where: { id } });
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function reorderPaymentAccounts(
  orderedIds: string[],
): Promise<ActionResult> {
  await requireAdmin();
  const rows = await prisma.paymentAccount.findMany({ select: { id: true } });
  const valid = new Set(rows.map((r) => r.id));
  if (orderedIds.length !== valid.size || !orderedIds.every((id) => valid.has(id))) {
    return { ok: false, error: "List is out of date — refresh the page." };
  }
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.paymentAccount.update({ where: { id }, data: { position: index } }),
    ),
  );
  revalidatePath("/admin/settings");
  return { ok: true };
}
