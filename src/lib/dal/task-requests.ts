import "server-only";
import { prisma } from "@/lib/prisma";
import { requireClient, requireTeam } from "@/lib/dal/session";
import { OPEN_REQUEST } from "@/lib/work-scope";

const clientSelect = { id: true, firstName: true, lastName: true, company: true } as const;
const projectSelect = { id: true, projectName: true, billingType: true } as const;

/**
 * The cross-project Requests inbox. What waits is read from the Requested
 * column — the same rows the nav badge counts and each project's list pins
 * on top — with the client's wording from the request beside it. Decided
 * requests come from the ledger, newest decision first, without their
 * descriptions: the inbox shows what happened to them, not what was asked.
 * Both reads in one wave, both bounded.
 *
 * The team's: staff decide requests too (accepting only at no charge, which
 * the accept action enforces), and nothing here carries a price.
 */
export async function listTaskRequests() {
  await requireTeam();
  const [waiting, decided] = await Promise.all([
    prisma.milestone.findMany({
      where: OPEN_REQUEST,
      orderBy: { createdAt: "asc" },
      take: 200,
      select: {
        id: true,
        title: true,
        createdAt: true,
        project: { select: projectSelect },
        sourceTaskRequest: {
          select: { id: true, description: true, client: { select: clientSelect } },
        },
        _count: { select: { comments: true } },
      },
    }),
    prisma.taskRequest.findMany({
      where: { status: { in: ["APPROVED", "REJECTED"] } },
      orderBy: [{ resolvedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        title: true,
        status: true,
        adminNote: true,
        createdAt: true,
        resolvedAt: true,
        client: { select: clientSelect },
        project: { select: projectSelect },
        milestone: { select: { id: true, stage: true, archivedAt: true } },
      },
    }),
  ]);
  return { waiting, decided };
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
 * the project ("Accepted, in progress").
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
