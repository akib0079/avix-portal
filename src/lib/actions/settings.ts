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

export async function updateWhatsappSupportUrl(url: string): Promise<ActionResult> {
  await requireAdmin();
  const trimmed = url.trim();
  if (trimmed && !/^https?:\/\/\S+$/i.test(trimmed)) {
    return { ok: false, error: "Enter a full link starting with https:// (or leave empty to hide it)." };
  }
  await prisma.appSetting.upsert({
    where: { key: "whatsappSupportUrl" },
    create: { key: "whatsappSupportUrl", value: trimmed },
    update: { value: trimmed },
  });
  revalidatePath("/admin/settings");
  return { ok: true };
}

// ---------- Branding ----------
import { saveUpload, deleteUpload } from "@/lib/uploads";
import { BRAND_KEYS, getBranding } from "@/lib/dal/settings";

async function setSetting(key: string, value: string) {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function updateBrandColor(color: string): Promise<ActionResult> {
  await requireAdmin();
  const trimmed = color.trim();
  if (trimmed && !/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return { ok: false, error: "Enter a 6-digit hex color like #F65D0B (or empty to reset)." };
  }
  await setSetting(BRAND_KEYS.color, trimmed);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Upload a new logo or favicon; replaces + deletes the previous file. */
export async function uploadBrandingFile(
  which: "logo" | "favicon",
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image file." };
  }
  const saved = await saveUpload("branding", file);
  if (!saved.ok) return { ok: false, error: saved.error };

  const key = which === "logo" ? BRAND_KEYS.logo : BRAND_KEYS.favicon;
  const current = await getBranding();
  const old = which === "logo" ? current.logoFile : current.faviconFile;

  await setSetting(key, saved.fileName);
  if (old) await deleteUpload("branding", old);

  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function clearBrandingFile(
  which: "logo" | "favicon",
): Promise<ActionResult> {
  await requireAdmin();
  const key = which === "logo" ? BRAND_KEYS.logo : BRAND_KEYS.favicon;
  const current = await getBranding();
  const old = which === "logo" ? current.logoFile : current.faviconFile;
  await setSetting(key, "");
  if (old) await deleteUpload("branding", old);
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");
  return { ok: true };
}
