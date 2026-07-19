"use client";

import dynamic from "next/dynamic";
import type { ProjectBillingType } from "@prisma/client";
import type { LeadView } from "@/lib/dal/leads";
import type { MilestoneView } from "@/components/milestones/milestone-types";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * dnd-kit ships with these two boards and is only needed once someone drags.
 * Both boards also pull in their form dialogs (and through them the editor),
 * so loading them on demand keeps a lot of code off the first paint of
 * /admin/leads and every project page.
 */

function BoardPlaceholder({ columns = 1 }: { columns?: number }) {
  return (
    <div
      className={
        columns > 1
          ? "grid grid-cols-1 gap-4 md:grid-cols-3"
          : "space-y-2"
      }
      aria-busy="true"
      aria-label="Loading board"
    >
      {Array.from({ length: columns > 1 ? columns : 4 }).map((_, i) => (
        <Skeleton key={i} className={columns > 1 ? "h-64" : "h-16 w-full"} />
      ))}
    </div>
  );
}

export const LeadBoard = dynamic<{ leads: LeadView[] }>(
  () => import("./leads/lead-board").then((m) => m.LeadBoard),
  { ssr: false, loading: () => <BoardPlaceholder columns={5} /> },
);

export const MilestoneBoard = dynamic<{
  projectId: string;
  milestones: MilestoneView[];
  billingType?: ProjectBillingType;
  canEditPricing?: boolean;
}>(() => import("./milestones/milestone-board").then((m) => m.MilestoneBoard), {
  ssr: false,
  loading: () => <BoardPlaceholder />,
});
