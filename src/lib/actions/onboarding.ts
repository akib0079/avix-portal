"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/lib/dal/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Marks the welcome guide as seen so it never shows again for this client. */
export async function completeOnboarding(): Promise<ActionResult> {
  const user = await requireClient();
  await prisma.user.update({
    where: { id: user.id },
    data: { onboardedAt: new Date() },
  });
  revalidatePath("/portal");
  return { ok: true };
}
