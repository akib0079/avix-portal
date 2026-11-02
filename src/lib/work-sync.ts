import type { PricingType, ProjectTaskStatus } from "@prisma/client";
import type { BoardPerson, WorkItem } from "@/lib/board";
import { stageToStatus } from "@/lib/work-stage";

/**
 * Rules the work store (components/board/work-store.tsx) keeps its copy of
 * the items by, between what it paints and what the server sends back. Pure
 * and dependency-free (types only), so they're tested once (work-sync.test.ts).
 */

/**
 * What accepting a request changed (AcceptChoice in work-dialogs.tsx). Only
 * what the accepter touched is in it; whatever is left out, the item keeps.
 */
export type AcceptedChange = {
  stage: ProjectTaskStatus;
  assigneeId?: string | null;
  dueDate?: string | null;
  parentId?: string | null;
  pricingType?: PricingType;
  hourlyRate?: number | null;
  estimatedHours?: number | null;
  fixedPrice?: number | null;
};

/**
 * An accepted request as the store paints it until its row comes back: in the
 * column the team picked, at `boardPosition`, with what the accepter changed.
 * A field the change leaves out keeps the item's own value, as the server
 * does (the person the client pinned, their date and phase, an admin's price),
 * and a price is painted only for a viewer who holds prices.
 */
export function acceptedItem(
  item: WorkItem,
  change: AcceptedChange,
  opts: { boardPosition: number; people: readonly BoardPerson[]; priced: boolean },
): WorkItem {
  const { stage, assigneeId, dueDate, parentId, pricingType } = change;
  const person = assigneeId ? opts.people.find((p) => p.id === assigneeId) : undefined;
  return {
    ...item,
    stage,
    status: stageToStatus(stage),
    boardPosition: opts.boardPosition,
    ...(assigneeId !== undefined
      ? { assigneeId, assignee: person ? { id: person.id, name: person.name, image: null } : null }
      : {}),
    ...(dueDate !== undefined ? { dueDate } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
    ...(opts.priced && pricingType
      ? {
          pricingType,
          hourlyRate: pricingType === "HOURLY" ? (change.hourlyRate ?? null) : null,
          estimatedHours: pricingType === "HOURLY" ? (change.estimatedHours ?? null) : null,
          fixedPrice: pricingType === "FIXED" ? (change.fixedPrice ?? null) : null,
        }
      : {}),
  };
}
