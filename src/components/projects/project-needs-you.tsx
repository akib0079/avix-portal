import Link from "next/link";
import type { PendingWork } from "@/lib/project-health";
import { cn } from "@/lib/utils";
import { CheckCircle2, ArrowRight } from "lucide-react";

/**
 * The client's to-do list for this project. Only rendered when something is
 * genuinely waiting on them — the portal's whole job is making that obvious,
 * and it was previously buried inside the timeline and the deliverables list.
 */
export function ProjectNeedsYou({
  pending,
  projectId,
  className,
}: {
  pending: PendingWork;
  projectId: string;
  className?: string;
}) {
  const items: { label: string; href: string }[] = [];

  if (pending.deliverablesAwaitingReview > 0) {
    items.push({
      label: `Review ${pending.deliverablesAwaitingReview} deliverable${pending.deliverablesAwaitingReview === 1 ? "" : "s"}`,
      href: `/portal/projects/${projectId}#deliverables`,
    });
  }
  if (pending.milestonesAwaitingApproval > 0) {
    items.push({
      label: `Approve ${pending.milestonesAwaitingApproval} completed milestone${pending.milestonesAwaitingApproval === 1 ? "" : "s"}`,
      href: `/portal/projects/${projectId}#timeline`,
    });
  }
  if (pending.milestonesAwaitingRating > 0) {
    items.push({
      label: `Rate ${pending.milestonesAwaitingRating} finished milestone${pending.milestonesAwaitingRating === 1 ? "" : "s"}`,
      href: `/portal/projects/${projectId}#timeline`,
    });
  }
  if (pending.unpaidInvoices > 0) {
    items.push({
      label: `Settle ${pending.unpaidInvoices} open invoice${pending.unpaidInvoices === 1 ? "" : "s"}`,
      href: "/portal/invoices",
    });
  }

  if (items.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
          className,
        )}
      >
        <CheckCircle2 className="size-4 shrink-0" />
        You&apos;re all caught up — nothing needs you on this project.
      </div>
    );
  }

  return (
    <div className={cn("rounded-2xl border border-primary/30 bg-brand-tint p-4", className)}>
      <p className="font-heading text-sm font-semibold">Needs you</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-primary"
            >
              <ArrowRight className="size-3.5 shrink-0 text-primary" />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
