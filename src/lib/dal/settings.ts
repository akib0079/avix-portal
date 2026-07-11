import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import type { PaymentField } from "@/lib/validation/payment";
import type { PaymentAccount } from "@prisma/client";

/** Serialized payment account safe for client components. */
export type PaymentAccountView = {
  id: string;
  title: string;
  region: PaymentAccount["region"];
  holderName: string;
  bankName: string;
  bankNote: string | null;
  note: string | null;
  isActive: boolean;
  position: number;
  fields: PaymentField[];
};

function toView(a: PaymentAccount): PaymentAccountView {
  return {
    id: a.id,
    title: a.title,
    region: a.region,
    holderName: a.holderName,
    bankName: a.bankName,
    bankNote: a.bankNote,
    note: a.note,
    isActive: a.isActive,
    position: a.position,
    fields: (a.fields as PaymentField[]) ?? [],
  };
}

/** All accounts, admin-only (Settings page). */
export async function listPaymentAccounts(): Promise<PaymentAccountView[]> {
  await requireAdmin();
  const rows = await prisma.paymentAccount.findMany({
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toView);
}

/** Active accounts only — shown to clients. No auth scoping needed (public
 *  bank details), but callers are already inside authenticated routes. */
export async function listActivePaymentAccounts(): Promise<PaymentAccountView[]> {
  const rows = await prisma.paymentAccount.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toView);
}

export const WHATSAPP_SETTING_KEY = "whatsappSupportUrl";

/** Admin-editable WhatsApp support link, or null when not configured. */
export async function getWhatsappSupportUrl(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({
    where: { key: WHATSAPP_SETTING_KEY },
  });
  return row?.value || null;
}
