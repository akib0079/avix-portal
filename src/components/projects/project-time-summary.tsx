import type { MilestoneView } from "@/components/milestones/milestone-types";
import { usd } from "@/lib/format";
import { Clock, BadgeDollarSign } from "lucide-react";

function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

/**
 * Compact time & billing roll-up for the admin project page. Server-safe —
 * takes already-serialized MilestoneViews (no Decimals).
 */
export function ProjectTimeSummary({
  milestones,
  billingType,
  contractPrice,
}: {
  milestones: MilestoneView[];
  billingType: "MILESTONE" | "CONTRACT";
  contractPrice: number | null;
}) {
  const totalLogged = milestones.reduce((sum, m) => sum + m.loggedHours, 0);
  const hourly = milestones.filter((m) => m.pricingType === "HOURLY");
  const totalEstimated = hourly.reduce((sum, m) => sum + (m.estimatedHours ?? 0), 0);
  const earnedHourly = hourly.reduce(
    (sum, m) => sum + m.loggedHours * (m.hourlyRate ?? 0),
    0,
  );

  if (totalLogged === 0 && billingType === "MILESTONE" && totalEstimated === 0) {
    return null; // nothing to summarize yet
  }

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="rounded-xl border bg-card p-4">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="size-3.5" /> Hours logged
        </p>
        <p className="font-heading mt-1 text-xl font-bold">
          {fmtHours(totalLogged)}
          {billingType === "MILESTONE" && totalEstimated > 0 && (
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              of {fmtHours(totalEstimated)} est
            </span>
          )}
        </p>
      </div>
      {billingType === "CONTRACT" ? (
        <div className="rounded-xl border bg-card p-4">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <BadgeDollarSign className="size-3.5" /> Contract price
          </p>
          <p className="font-heading mt-1 text-xl font-bold text-primary">
            {contractPrice != null ? usd.format(contractPrice) : "—"}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card p-4">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <BadgeDollarSign className="size-3.5" /> Earned (hourly × logged)
          </p>
          <p className="font-heading mt-1 text-xl font-bold text-primary">
            {usd.format(earnedHourly)}
          </p>
        </div>
      )}
      <div className="rounded-xl border bg-card p-4">
        <p className="text-sm text-muted-foreground">Milestones with time</p>
        <p className="font-heading mt-1 text-xl font-bold">
          {milestones.filter((m) => m.loggedHours > 0).length}
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            of {milestones.length}
          </span>
        </p>
      </div>
    </div>
  );
}
