import type { Prisma } from "@prisma/client";

/**
 * Which work items count for what — defined once for every surface that
 * counts them: the per-project "Needs you" box and the admin attention strip
 * (through project-health.ts), the portal's action centre and its badge
 * (portal-actions.ts), progress bars and the dashboard.
 *
 * Each rule comes twice: as a Prisma filter, for counting in the database, and
 * as a predicate over items already loaded. They sit side by side so a change
 * to one is a change to both. Dependency-free (types only), so client
 * components can use the predicates.
 */

type Itemish = {
  stage?: string;
  archivedAt?: string | Date | null;
  parentId?: string | null;
};

/**
 * The plan: accepted, live, top-level work — what "3 of 7 milestones done"
 * counts. Sub-items roll up into their phase, and a request isn't plan work
 * until it's accepted.
 */
export const PLAN_ITEM = {
  archivedAt: null,
  parentId: null,
  stage: { not: "REQUESTED" },
} satisfies Prisma.MilestoneWhereInput;

export function isPlanItem(item: Itemish): boolean {
  return !item.archivedAt && !item.parentId && item.stage !== "REQUESTED";
}

/** A client's request still waiting for the team's decision. */
export const OPEN_REQUEST = {
  archivedAt: null,
  stage: "REQUESTED",
} satisfies Prisma.MilestoneWhereInput;

export function isOpenRequest(item: Itemish): boolean {
  return !item.archivedAt && item.stage === "REQUESTED";
}

/** Work the team finished and sent for the client's check. */
export const AWAITING_REVIEW = {
  archivedAt: null,
  stage: "REVIEW",
} satisfies Prisma.MilestoneWhereInput;

export function isAwaitingReview(item: Itemish): boolean {
  return !item.archivedAt && item.stage === "REVIEW";
}

/** A question the team asked on the item that the client hasn't answered. */
export const TEAM_QUESTION = {
  archivedAt: null,
  comments: { some: { kind: "HELP", authorRole: "ADMIN", resolvedAt: null } },
} satisfies Prisma.MilestoneWhereInput;

export function hasTeamQuestion(item: Itemish & { openHelp: { team: number } }): boolean {
  return !item.archivedAt && item.openHelp.team > 0;
}

/**
 * Finished top-level work the client approved but hasn't rated. Rating asks
 * about a phase or a milestone, not every small task, and only once the
 * client has signed it off — work the team closed on its own doesn't nag.
 */
export const AWAITING_RATING = {
  archivedAt: null,
  parentId: null,
  stage: "DONE",
  clientApprovedAt: { not: null },
  clientRating: null,
} satisfies Prisma.MilestoneWhereInput;

export function isAwaitingRating(
  item: Itemish & { clientApprovedAt: string | Date | null; clientRating: number | null },
): boolean {
  return (
    !item.archivedAt &&
    !item.parentId &&
    item.stage === "DONE" &&
    !!item.clientApprovedAt &&
    item.clientRating == null
  );
}

/** How many items wait on the client, by reason. */
export function clientWaiting(
  items: (Itemish & {
    openHelp: { team: number };
    clientApprovedAt: string | Date | null;
    clientRating: number | null;
  })[],
): { review: number; questions: number; rating: number } {
  return {
    review: items.filter(isAwaitingReview).length,
    questions: items.filter(hasTeamQuestion).length,
    rating: items.filter(isAwaitingRating).length,
  };
}
