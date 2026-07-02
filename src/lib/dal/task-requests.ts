import "server-only";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireClient } from "@/lib/dal/session";
import type { TaskRequestStatus } from "@prisma/client";

export async function listTaskRequests(status?: TaskRequestStatus) {
  await requireAdmin();
  return prisma.taskRequest.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { id: true, firstName: true, lastName: true, company: true } },
      project: { select: { id: true, projectName: true } },
    },
  });
}

export async function countPendingTaskRequests() {
  return prisma.taskRequest.count({ where: { status: "PENDING" } });
}

export async function listMyTaskRequests() {
  const user = await requireClient();
  return prisma.taskRequest.findMany({
    where: { clientId: user.id },
    orderBy: { createdAt: "desc" },
    include: { project: { select: { id: true, projectName: true } } },
  });
}
