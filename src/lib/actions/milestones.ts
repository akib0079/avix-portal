"use server";

import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/dal/session";

/**
 * The Milestones list's own write: the plan's order. Everything else the list
 * does — stage, assignee, edits, archive, time — goes through the same
 * actions as the board (actions/project-board.tsx), so the two views can't
 * drift apart in what a change means or who may make it.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * The list's drag: the plan's new order, every live item of the project in
 * it. No revalidatePath — the list and board are client state kept current by
 * their poll (the moved rows' updatedAt changes the version token), and a
 * revalidation would re-render the whole project page into every drag's
 * response.
 */
export async function reorderMilestones(
  projectId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  await requireTeam();

  // The list shows live items only; archived ones keep their old places.
  const milestones = await prisma.milestone.findMany({
    where: { projectId, archivedAt: null },
    select: { id: true, position: true },
  });
  const current = new Map(milestones.map((m) => [m.id, m.position]));
  if (
    orderedIds.length !== current.size ||
    !orderedIds.every((id) => current.has(id))
  ) {
    // Someone added or archived an item meanwhile; the list refreshes itself.
    return { ok: false, error: "The list changed since it loaded — try that again." };
  }

  // Only the rows whose place changed are written — on a long plan that can
  // be most of them — in one statement: one round trip, all or nothing.
  // updatedAt is set by hand (a raw write skips @updatedAt): the poll's
  // version token reads it.
  const changed = orderedIds
    .map((id, index) => ({ id, index }))
    .filter(({ id, index }) => current.get(id) !== index);
  if (changed.length) {
    const now = new Date();
    await prisma.$executeRaw`
      UPDATE "milestones" AS m
      SET "position" = v."pos", "updatedAt" = ${now}::timestamp
      FROM unnest(${changed.map((c) => c.id)}::text[], ${changed.map((c) => c.index)}::int[]) AS v("id", "pos")
      WHERE m."id" = v."id" AND m."projectId" = ${projectId}`;
  }
  return { ok: true };
}
