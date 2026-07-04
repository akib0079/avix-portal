"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal/session";

/** Marks the signed-in user's notifications as read (all, or a specific set). */
export async function markNotificationsRead(ids?: string[]): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: {
      userId: user.id,
      readAt: null,
      ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
    },
    data: { readAt: new Date() },
  });
  return { ok: true };
}
