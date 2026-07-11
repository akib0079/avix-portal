import { RichTextViewer, hasRichTextContent } from "@/components/editor/rich-text-viewer";
import { MilestoneStatusBadge } from "@/components/status-badges";
import { ApproveMilestoneButton } from "@/components/portal/approve-milestone-button";
import { formatPricing, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MilestoneStatus, PricingType, ProjectBillingType } from "@prisma/client";
import { Check, CircleDashed, LoaderCircle, BadgeDollarSign, Clock } from "lucide-react";

type TimelineMilestone = {
  id: string;
  title: string;
  status: MilestoneStatus;
  description: unknown;
  pricingType: PricingType;
  hourlyRate: number | null;
  estimatedHours: number | null;
  fixedPrice: number | null;
  loggedHours: number;
  timeEntries: { id: string; date: string; hours: number; note: string | null }[];
  clientApprovedAt: string | null;
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
    <span className="flex size-7 items-center justify-center rounded-full border-2 border-slate-200 bg-white text-slate-400">
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
        const recentEntries = milestone.timeEntries.slice(0, 3);
        const isLast = index === milestones.length - 1;
        return (
          <li key={milestone.id} className="relative flex gap-4 pb-8 last:pb-0">
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-8 left-[13px] h-[calc(100%-2rem)] w-0.5",
                  milestone.status === "COMPLETED" ? "bg-success/40" : "bg-slate-200",
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
              {hasRichTextContent(milestone.description) && (
                <div className="mt-2 rounded-lg bg-muted/50 px-3.5 py-2.5">
                  <RichTextViewer content={milestone.description} />
                </div>
              )}
              {milestone.status === "COMPLETED" && (
                <ApproveMilestoneButton
                  milestoneId={milestone.id}
                  approvedAt={milestone.clientApprovedAt}
                />
              )}
              {recentEntries.some((e) => e.note) && (
                <ul className="mt-2 space-y-1.5">
                  {recentEntries
                    .filter((e) => e.note)
                    .map((entry) => (
                      <li
                        key={entry.id}
                        className="rounded-lg border border-slate-100 bg-white px-3.5 py-2 text-xs"
                      >
                        <span className="font-medium text-foreground">
                          {formatDate(entry.date)} · {fmtHours(entry.hours)}
                        </span>{" "}
                        <span className="whitespace-pre-wrap text-muted-foreground">
                          — {entry.note}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
