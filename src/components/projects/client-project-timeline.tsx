import { MilestoneStatusBadge } from "@/components/status-badges";
import { ApproveMilestoneButton } from "@/components/portal/approve-milestone-button";
import { RateMilestone } from "@/components/portal/rate-milestone";
import { ItemDetails } from "@/components/milestones/item-details";
import { formatPricing } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  MilestoneStatus,
  PricingType,
  ProjectBillingType,
  ProjectTaskStatus,
} from "@prisma/client";
import { Check, CircleDashed, LoaderCircle, BadgeDollarSign, Clock } from "lucide-react";

/**
 * The plan as the client follows it: top-level work in order. Descriptions
 * and progress notes load with the item when opened (see ItemDetails).
 */
type TimelineMilestone = {
  id: string;
  title: string;
  status: MilestoneStatus;
  stage: ProjectTaskStatus;
  hasDescription: boolean;
  pricingType: PricingType;
  hourlyRate: number | null;
  estimatedHours: number | null;
  fixedPrice: number | null;
  loggedHours: number;
  clientApprovedAt: string | null;
  clientRating: number | null;
  clientRatingNote: string | null;
};

function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function StatusIcon({ status }: { status: MilestoneStatus }) {
  if (status === "COMPLETED") {
    return (
      <span className="flex size-7 items-center justify-center rounded-full bg-success text-white">
        <Check className="size-4" />
      </span>
    );
  }
  if (status === "IN_PROGRESS") {
    return (
      <span className="flex size-7 items-center justify-center rounded-full bg-info text-white">
        <LoaderCircle className="size-4" />
      </span>
    );
  }
  return (
    <span className="flex size-7 items-center justify-center rounded-full border-2 border-border bg-card text-muted-foreground">
      <CircleDashed className="size-4" />
    </span>
  );
}

export function ClientProjectTimeline({
  milestones,
  billingType = "MILESTONE",
}: {
  milestones: TimelineMilestone[];
  billingType?: ProjectBillingType;
}) {
  if (milestones.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Milestones will appear here once the project is scoped.
      </p>
    );
  }

  return (
    <ol className="relative space-y-0">
      {milestones.map((milestone, index) => {
        // On fixed-contract projects the price lives at the project level.
        const pricing = billingType === "CONTRACT" ? null : formatPricing(milestone);
        const isLast = index === milestones.length - 1;
        return (
          <li key={milestone.id} className="relative flex gap-4 pb-8 last:pb-0">
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-8 left-[13px] h-[calc(100%-2rem)] w-0.5",
                  milestone.status === "COMPLETED" ? "bg-success/40" : "bg-border",
                )}
              />
            )}
            <div className="relative z-10 shrink-0 pt-0.5">
              <StatusIcon status={milestone.status} />
            </div>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  className={cn(
                    "font-medium",
                    milestone.status === "COMPLETED" && "text-muted-foreground",
                  )}
                >
                  {milestone.title}
                </h3>
                <MilestoneStatusBadge status={milestone.status} />
              </div>
              {pricing && (
                <p className="mt-1 flex items-center gap-1 text-xs font-medium text-primary">
                  <BadgeDollarSign className="size-3.5" /> {pricing}
                </p>
              )}
              {milestone.loggedHours > 0 && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3.5" />
                  {fmtHours(milestone.loggedHours)} worked
                </p>
              )}
              {(milestone.hasDescription || milestone.loggedHours > 0) && (
                <ItemDetails
                  itemId={milestone.id}
                  hasDescription={milestone.hasDescription}
                  showNotes
                  className="mt-2"
                />
              )}
              {/* In review asks for the client's OK; work finished before
                  the review step existed can still be approved. */}
              {milestone.status === "COMPLETED" && (
                <ApproveMilestoneButton
                  milestoneId={milestone.id}
                  approvedAt={milestone.clientApprovedAt}
                />
              )}
              {milestone.stage === "DONE" && (
                <RateMilestone
                  milestoneId={milestone.id}
                  rating={milestone.clientRating}
                  note={milestone.clientRatingNote}
                />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
