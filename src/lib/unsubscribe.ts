import "server-only";
import { prisma } from "@/lib/prisma";
import { verifyUnsubscribeToken } from "@/lib/marketing-token";

/**
 * Apply an unsubscribe token. Shared by the confirm page's action and the
 * one-click POST endpoint mail clients call via List-Unsubscribe-Post.
 * Returns false for a bad token or a subject that no longer exists.
 */
export async function applyUnsubscribe(token: string | undefined): Promise<boolean> {
  const subject = token ? verifyUnsubscribeToken(token) : null;
  if (!subject) return false;

  if (subject.startsWith("lead:")) {
    const result = await prisma.lead.updateMany({
      where: { id: subject.slice(5) },
      data: { marketingOptOut: true },
    });
    return result.count > 0;
  }

  const result = await prisma.user.updateMany({
    where: { id: subject },
    data: { marketingOptOut: true },
  });
  return result.count > 0;
}
