"use client";

import Link from "next/link";
import type { PendingWork } from "@/lib/project-health";
import { WORK_TAB, workItemHref, type WorkItem } from "@/lib/board";
import { hasTeamQuestion, isAwaitingRating, isAwaitingReview } from "@/lib/work-scope";
import { useWorkOptional } from "@/components/board/work-store";
import { cn } from "@/lib/utils";
import { CheckCircle2, ArrowRight } from "lucide-react";

/**
 * The client's to-do list for this project. Only rendered when something is
 * genuinely waiting on them — the portal's whole job is making that obvious,
 * and it was previously buried inside the timeline and the deliverables list.
 *
 * The counts come from the same rules as the portal's action centre
 * (work-scope.ts), so this box and that page always agree. On the project
 * page the work counts follow the live items: approving the last item in
 * review clears its line at once.
 */
export function ProjectNeedsYou({
  pending,
  projectId,
  questions = 0,
  className,
}: {
  pending: PendingWork;
  projectId: string;
  /** Items carrying a question from the team that the client hasn't answered (server count). */
  questions?: number;
  className?: string;
}) {
  const work = useWorkOptional();
  const items: { label: string; href: string }[] = [];
  const base = `/portal/projects/${projectId}`;
  const list = `${base}?tab=${WORK_TAB}&view=list`;
  const tab = (t: string) => `${base}?tab=${t}`;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  // One item: straight to it. Several: the list, where each has its buttons.
  const to = (found: WorkItem[]) => (found.length === 1 ? workItemHref(projectId, found[0]!.id, "CLIENT", "list") : list);

  const live = work?.items ?? null;
  const review = live ? live.filter(isAwaitingReview) : null;
  const asked = live ? live.filter(hasTeamQuestion) : null;
  const rate = live ? live.filter(isAwaitingRating) : null;
  const reviewCount = review?.length ?? pending.milestonesAwaitingApproval;
  const questionCount = asked?.length ?? questions;
  const rateCount = rate?.length ?? pending.milestonesAwaitingRating;

  if (questionCount > 0) {
    items.push({ label: `Answer ${plural(questionCount, "question")}`, href: asked ? to(asked) : list });
  }
  if (reviewCount > 0) {
    items.push({ label: `Review ${plural(reviewCount, "item")}`, href: review ? to(review) : list });
  }
  if (pending.deliverablesAwaitingReview > 0) {
    items.push({
      label: `Review ${plural(pending.deliverablesAwaitingReview, "deliverable")}`,
      href: tab("files"),
    });
  }
  if (rateCount > 0) {
    items.push({ label: `Rate ${plural(rateCount, "item")}`, href: rate ? to(rate) : list });
  }
  if (pending.invoicesToPay > 0) {
    items.push({ label: `Pay ${plural(pending.invoicesToPay, "invoice")}`, href: tab("billing") });
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
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
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
