"use client";

import type { ProjectStatus } from "@prisma/client";
import { projectHealth } from "@/lib/project-health";
import { clientWaiting } from "@/lib/work-scope";
import { useWork } from "@/components/board/work-store";
import { cn } from "@/lib/utils";
import { CircleDot } from "lucide-react";

/**
 * The portal project header's live parts: progress, what's open, what's
 * waiting on the client, and what's up next. They read the Milestones tab's
 * store, so approving an item or the team finishing one moves them at once,
 * not on the next page load.
 */
export function PortalPulse({
  status,
  dueDate,
  renderedAt,
}: {
  status: ProjectStatus;
  dueDate: string | null;
  /** Server time, so "due in N days" matches between server and browser. */
  renderedAt: number;
}) {
  const { items } = useWork();
  const health = projectHealth({ milestones: items, status, dueDate, now: new Date(renderedAt) });
  const waiting = clientWaiting(items);
  const open = items.filter((i) => i.stage !== "DONE" && i.stage !== "REQUESTED").length;

  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {health.done} of {health.total} milestone{health.total === 1 ? "" : "s"} complete
          </span>
          <span className="num font-semibold">{health.percent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-700"
            style={{ width: `${health.percent}%` }}
          />
        </div>
      </div>
      <div className="flex gap-5 text-sm sm:justify-end">
        <Stat label="Open" value={open} />
        <Stat label="Waiting on you" value={waiting.review + waiting.questions + waiting.rating} hot />
      </div>
    </div>
  );
}

/** "Up next: Design" — the plan item the team is on, or will be next. */
export function PortalUpNext({ status }: { status: ProjectStatus }) {
  const { items } = useWork();
  const health = projectHealth({ milestones: items, status });
  if (!health.nextMilestone || status === "COMPLETED") return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <CircleDot className="size-3.5 shrink-0 text-primary" />
      <span className="text-muted-foreground">Up next:</span>
      <span className="truncate font-medium">{health.nextMilestone.title}</span>
    </span>
  );
}

function Stat({ label, value, hot }: { label: string; value: number; hot?: boolean }) {
  return (
    <div className="text-right">
      <p className={cn("num text-xl font-semibold", hot && value > 0 && "text-primary")}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
