"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RichTextViewer } from "@/components/editor/rich-text-viewer";
import { RequestReviewActions } from "./request-review-actions";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TaskRequestStatus } from "@prisma/client";
import { CircleUser, FolderKanban, Clock, ChevronDown } from "lucide-react";

/**
 * One request, as a card on its lane. The lane already says the status, so
 * the card spends its space on who asked, for which project, and what. A
 * long brief folds to a few lines — a lane of full essays could not be
 * scanned — and opens in place.
 */
export function RequestCard({
  request,
  waitingDays,
  stale,
}: {
  request: {
    id: string;
    title: string;
    description: unknown;
    status: TaskRequestStatus;
    adminNote: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
    client: { id: string; firstName: string; lastName: string; company: string | null };
    project: { id: string; projectName: string };
  };
  /** Days since it was submitted. */
  waitingDays: number;
  /** Pending past the SLA: called out on the card. */
  stale: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Only offer "Show all" when the brief is actually cut off.
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Fires once on observe, then whenever the card's width reflows the text.
    const ro = new ResizeObserver(() => setOverflows(el.scrollHeight > el.clientHeight + 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const clientName = `${request.client.firstName} ${request.client.lastName}`;

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card p-3.5 shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-[box-shadow,border-color] duration-150 hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] hover:shadow-[0_6px_20px_-10px_rgb(15_23_42/0.25)]",
        stale && "border-amber-300 dark:border-amber-800",
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />

      {stale && (
        <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300">
          <Clock className="size-3" /> Waiting {waitingDays} days
        </span>
      )}

      <h3 className="text-sm leading-snug font-semibold [overflow-wrap:anywhere]">
        {request.title}
      </h3>
      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
        <Link
          href={`/admin/clients/${request.client.id}`}
          className="flex min-w-0 items-center gap-1 hover:text-primary"
        >
          <CircleUser className="size-3 shrink-0" />
          <span className="truncate">
            {clientName}
            {request.client.company ? ` · ${request.client.company}` : ""}
          </span>
        </Link>
        <Link
          href={`/admin/projects/${request.project.id}`}
          className="flex min-w-0 items-center gap-1 hover:text-primary"
        >
          <FolderKanban className="size-3 shrink-0" />
          <span className="truncate">{request.project.projectName}</span>
        </Link>
        <p className="tabular-nums">
          {formatDate(request.createdAt)}
          {request.resolvedAt && ` → ${formatDate(request.resolvedAt)}`}
          {request.status === "PENDING" && !stale && waitingDays > 0 && ` · ${waitingDays}d waiting`}
        </p>
      </div>

      <div className="relative mt-3 rounded-lg bg-muted/50 px-3 py-2.5">
        <div ref={bodyRef} className={cn("text-[13px]", !open && "max-h-28 overflow-hidden")}>
          <RichTextViewer content={request.description} />
        </div>
        {!open && overflows && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="absolute inset-x-0 bottom-0 flex items-end justify-center rounded-b-lg bg-gradient-to-t from-muted via-muted/80 to-transparent pt-8 pb-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="mr-0.5 size-3" /> Show all
          </button>
        )}
      </div>

      {request.status === "REJECTED" && request.adminNote && (
        <p className="mt-2.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">
          <span className="font-medium">Note:</span> {request.adminNote}
        </p>
      )}

      {request.status === "PENDING" && (
        <div className="mt-3 border-t pt-3">
          <RequestReviewActions request={{ id: request.id, title: request.title, clientName }} />
        </div>
      )}
    </article>
  );
}
