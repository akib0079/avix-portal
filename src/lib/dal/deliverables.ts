import "server-only";
import { prisma } from "@/lib/prisma";

/** Deliverables for a project, newest first. Caller authorizes the project. */
export async function listByProject(projectId: string) {
  return prisma.deliverable.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      filePath: true,
      fileOriginalName: true,
      externalUrl: true,
      createdAt: true,
    },
  });
}

export type DeliverableRow = Awaited<ReturnType<typeof listByProject>>[number];
