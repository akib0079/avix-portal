"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { AGENCY_TZ_KEY, SLOT_MIN_KEY, BOOKING_URL_KEY } from "@/lib/dal/availability";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type AvailabilityInput = {
  agencyTimezone: string;
  slotMinutes: number;
  bookingUrl: string;
  windows: { weekday: number; startMin: number; endMin: number }[];
};

function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Replace the weekly availability windows and booking config in one shot. */
export async function saveAvailability(input: AvailabilityInput): Promise<ActionResult> {
  await requireAdmin();

  const tz = input.agencyTimezone?.trim();
  if (!tz || !validTz(tz)) return { ok: false, error: "Pick a valid timezone." };

  const slot = Math.round(Number(input.slotMinutes));
  if (!Number.isFinite(slot) || slot < 10 || slot > 240) {
    return { ok: false, error: "Slot length must be between 10 and 240 minutes." };
  }

  const url = input.bookingUrl?.trim() ?? "";
  if (url && !/^https?:\/\/\S+$/i.test(url)) {
    return { ok: false, error: "Meeting link must start with http:// or https://" };
  }

  const windows = (input.windows ?? []).filter(
    (w) =>
      Number.isInteger(w.weekday) &&
      w.weekday >= 0 &&
      w.weekday <= 6 &&
      Number.isInteger(w.startMin) &&
      Number.isInteger(w.endMin) &&
      w.startMin >= 0 &&
      w.endMin <= 1440 &&
      w.startMin < w.endMin,
  );

  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: AGENCY_TZ_KEY },
      create: { key: AGENCY_TZ_KEY, value: tz },
      update: { value: tz },
    }),
    prisma.appSetting.upsert({
      where: { key: SLOT_MIN_KEY },
      create: { key: SLOT_MIN_KEY, value: String(slot) },
      update: { value: String(slot) },
    }),
    prisma.appSetting.upsert({
      where: { key: BOOKING_URL_KEY },
      create: { key: BOOKING_URL_KEY, value: url },
      update: { value: url },
    }),
    prisma.availabilityWindow.deleteMany({}),
    prisma.availabilityWindow.createMany({
      data: windows.map((w) => ({
        weekday: w.weekday,
        startMin: w.startMin,
        endMin: w.endMin,
        active: true,
      })),
    }),
  ]);

  revalidatePath("/admin/settings");
  revalidatePath("/portal/book");
  return { ok: true };
}
