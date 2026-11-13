import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** What a deliverables list shows; the admin project page selects it on the project. */
export const deliverableSelect = {
  id: true,
  title: true,
  filePath: true,
  fileOriginalName: true,
  externalUrl: true,
  reviewStatus: true,
  reviewNote: true,
  reviewedAt: true,
  createdAt: true,
} satisfies Prisma.DeliverableSelect;

/** Deliverables for a project, newest first. Caller authorizes the project. */
export async function listByProject(projectId: string) {
  return prisma.deliverable.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: deliverableSelect,
  });
}

export type DeliverableRow = Awaited<ReturnType<typeof listByProject>>[number];
