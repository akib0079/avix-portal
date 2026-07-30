import Link from "next/link";
import type { PendingWork } from "@/lib/project-health";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

type Item = { label: string; href: string; tone: "warn" | "bad" | "info" };

/**
 * What's waiting on someone, at the top of the project. Renders nothing when
 * the project is clean — an always-present empty banner trains people to
 * ignore it.
 */
export function ProjectAttention({
  pending,
  projectId,
  overdue,
  className,
}: {
  pending: PendingWork;
  projectId: string;
  overdue: boolean;
  className?: string;
}) {
  const base = `/admin/projects/${projectId}`;
  const items: Item[] = [];

  if (overdue) {
    items.push({ label: "Past its due date", href: `${base}?tab=milestones`, tone: "bad" });
  }
  if (pending.deliverablesNeedingChanges > 0) {
    items.push({
      label: `${pending.deliverablesNeedingChanges} deliverable${pending.deliverablesNeedingChanges === 1 ? "" : "s"} sent back`,
      href: `${base}?tab=deliverables`,
      tone: "bad",
    });
  }
  if (pending.openRequests > 0) {
    items.push({
      label: `${pending.openRequests} open request${pending.openRequests === 1 ? "" : "s"}`,
      href: `${base}?tab=requests`,
      tone: "warn",
    });
  }
  if (pending.milestonesAwaitingApproval > 0) {
    items.push({
      label: `${pending.milestonesAwaitingApproval} awaiting client approval`,
      href: `${base}?tab=milestones`,
      tone: "info",
    });
  }
  if (pending.deliverablesAwaitingReview > 0) {
    items.push({
      label: `${pending.deliverablesAwaitingReview} deliverable${pending.deliverablesAwaitingReview === 1 ? "" : "s"} awaiting review`,
      href: `${base}?tab=deliverables`,
      tone: "info",
    });
  }
  if (pending.unpaidInvoices > 0) {
    items.push({
      label: `${pending.unpaidInvoices} unpaid invoice${pending.unpaidInvoices === 1 ? "" : "s"}`,
      href: `${base}?tab=money`,
      tone: "warn",
    });
  }

  if (items.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
          className,
        )}
      >
        <CheckCircle2 className="size-4 shrink-0" />
        Nothing is waiting — everything here is up to date.
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <AlertTriangle className="size-4 text-amber-500" />
        Needs attention
      </span>
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80",
            item.tone === "bad"
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
              : item.tone === "warn"
                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
                : "border-border bg-muted text-muted-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
