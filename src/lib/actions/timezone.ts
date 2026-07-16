"use server";

import { prisma } from "@/lib/prisma";
import { requireClient } from "@/lib/dal/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** True when the string is a valid IANA timezone this runtime knows. */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-fills the client's timezone from their browser. Only fills when EMPTY —
 * an admin's manual edit is never overwritten by a page load.
 */
export async function syncMyTimezone(timezone: string): Promise<ActionResult> {
  const user = await requireClient();
  const tz = timezone.trim();
  if (!tz || tz.length > 64 || !isValidTimezone(tz)) {
    return { ok: false, error: "Invalid timezone." };
  }
  await prisma.user.updateMany({
    where: { id: user.id, timezone: null },
    data: { timezone: tz },
  });
  return { ok: true };
}
