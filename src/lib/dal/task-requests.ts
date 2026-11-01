import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireClient } from "@/lib/dal/session";
import { OPEN_REQUEST } from "@/lib/work-scope";
import type { TaskRequestStatus } from "@prisma/client";

/**
 * The cross-project request inbox. Bounded: decided requests only ever
 * accumulate, and the board pages its columns anyway. Each request carries
 * the work item it created, for a link straight to it.
 */
export async function listTaskRequests(status?: TaskRequestStatus) {
  await requireAdmin();
  return prisma.taskRequest.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      client: { select: { id: true, firstName: true, lastName: true, company: true } },
      project: { select: { id: true, projectName: true } },
      milestone: { select: { id: true, stage: true, archivedAt: true } },
    },
  });
}

/**
 * Requests waiting for a decision — the nav badge. Counted from the
 * Requested column, which holds exactly the PENDING requests.
 */
export async function countPendingTaskRequests() {
  return prisma.milestone.count({ where: OPEN_REQUEST });
}

/**
 * The client's request history, with where each accepted one now stands on
 * the project ("Accepted · In progress").
 */
export async function listMyTaskRequests() {
  const user = await requireClient();
  return prisma.taskRequest.findMany({
    where: { clientId: user.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      project: { select: { id: true, projectName: true } },
      milestone: { select: { id: true, stage: true, archivedAt: true } },
    },
  });
}
