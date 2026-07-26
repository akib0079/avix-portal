"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal/session";
import { disconnectCalendar, reconcileFromGoogle } from "@/lib/google-calendar";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function disconnectGoogleCalendar(): Promise<ActionResult> {
  await requireAdmin();
  await disconnectCalendar();
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function syncGoogleCalendar(): Promise<ActionResult<{ cancelled: number }>> {
  await requireAdmin();
  const res = await reconcileFromGoogle();
  if (!res.ok) return { ok: false, error: res.error ?? "Sync failed." };
  revalidatePath("/admin/calendar");
  return { ok: true, data: { cancelled: res.cancelled } };
}
