"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/lib/dal/session";
import { clientProfileSchema, type ClientProfileInput } from "@/lib/validation/profile";

export type ActionResult = { ok: true } | { ok: false; error: string };

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A client updates their OWN profile. Email and role are deliberately fixed. */
export async function updateMyProfile(input: ClientProfileInput): Promise<ActionResult> {
  const user = await requireClient();
  const parsed = clientProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const tz = data.timezone?.trim() ?? "";
  if (tz && !validTimezone(tz)) {
    return { ok: false, error: "That timezone isn't recognised." };
  }

  const firstName = data.firstName.trim();
  const lastName = (data.lastName ?? "").trim();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
      company: data.company?.trim() || null,
      phone: data.phone?.trim() || null,
      timezone: tz || null,
      marketingOptOut: data.marketingOptOut,
    },
  });

  revalidatePath("/portal/settings");
  revalidatePath("/portal");
  return { ok: true };
}
