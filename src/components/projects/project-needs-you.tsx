import Link from "next/link";
import type { PendingWork } from "@/lib/project-health";
import { cn } from "@/lib/utils";
import { CheckCircle2, ArrowRight } from "lucide-react";

/**
 * The client's to-do list for this project. Only rendered when something is
 * genuinely waiting on them — the portal's whole job is making that obvious,
 * and it was previously buried inside the timeline and the deliverables list.
 *
 * The counts come from the same rules as the portal's action centre
 * (work-scope.ts), so this box and that page always agree.
 */
export function ProjectNeedsYou({
  pending,
  projectId,
  questions = 0,
  className,
}: {
  pending: PendingWork;
  projectId: string;
  /** Items carrying a question from the team that the client hasn't answered. */
  questions?: number;
  className?: string;
}) {
  const items: { label: string; href: string }[] = [];
  const base = `/portal/projects/${projectId}`;
  const work = (view: "board" | "list") => `${base}?tab=milestones&view=${view}`;
  const tab = (t: string) => `${base}?tab=${t}`;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  if (questions > 0) {
    items.push({
      label: `Answer ${plural(questions, "question")} from the team`,
      href: work("board"),
    });
  }
  if (pending.milestonesAwaitingApproval > 0) {
    items.push({
      label: `Review ${plural(pending.milestonesAwaitingApproval, "finished item")}`,
      href: work("board"),
    });
  }
  if (pending.deliverablesAwaitingReview > 0) {
    items.push({
      label: `Review ${plural(pending.deliverablesAwaitingReview, "deliverable")}`,
      href: tab("files"),
    });
  }
  if (pending.milestonesAwaitingRating > 0) {
    items.push({
      label: `Rate ${plural(pending.milestonesAwaitingRating, "finished milestone")}`,
      href: work("list"),
    });
  }
  if (pending.unpaidInvoices > 0) {
    items.push({
      label: `Settle ${plural(pending.unpaidInvoices, "open invoice")}`,
      href: tab("billing"),
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
