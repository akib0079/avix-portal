import "server-only";
import { prisma } from "@/lib/prisma";

export type ActivityInput = {
  type: string;
  summary: string;
  actorId?: string | null;
  clientId?: string | null;
  entity?: string | null;
  entityId?: string | null;
  link?: string | null;
};

/**
 * Records an audit event. BEST-EFFORT: a logging failure must never break the
 * mutation that triggered it, so all errors are swallowed (like the duties
 * engine). Fire-and-forget is fine — callers need not await.
 */
export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    await prisma.activityEvent.create({
      data: {
        type: input.type,
        summary: input.summary,
        actorId: input.actorId ?? null,
        clientId: input.clientId ?? null,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        link: input.link ?? null,
      },
    });
  } catch (err) {
    console.error("[activity] log failed:", (err as Error).message);
  }
}

/** Recent activity, newest first. Scope to a client with clientId. Admin-only reads. */
export async function listActivity(opts?: { clientId?: string; take?: number }) {
  const rows = await prisma.activityEvent.findMany({
    where: opts?.clientId ? { clientId: opts.clientId } : undefined,
    orderBy: { createdAt: "desc" },
    take: opts?.take ?? 20,
    select: {
      id: true,
      type: true,
      summary: true,
      link: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    summary: r.summary,
    link: r.link,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type ActivityRow = Awaited<ReturnType<typeof listActivity>>[number];
