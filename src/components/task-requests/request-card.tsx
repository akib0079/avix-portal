"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RichTextViewer } from "@/components/editor/rich-text-viewer";
import { SoftPill } from "@/components/ui/status-pill";
import { RequestReviewActions } from "./request-review-actions";
import { COLUMN_BY_ID, workItemHref, type WorkRole } from "@/lib/board";
import { requestLabel } from "@/lib/work-list";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InboxRequest } from "./request-board";
import { CircleUser, FolderKanban, Clock, ChevronDown, MessageSquare } from "lucide-react";

/**
 * One request, as a card on its lane. The lane already says how it was
 * decided, so the card spends its space on who asked, for which project,
 * what — and, once accepted, where the work is now. The title opens the
 * item on its project. A long brief folds to a few lines and opens in place.
 */
export function RequestCard({
  request,
  waitingDays,
  stale,
  role,
}: {
  request: InboxRequest;
  /** Days since it was submitted. */
  waitingDays: number;
  /** Waiting past the SLA: called out on the card. */
  stale: boolean;
  role: WorkRole;
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
  const clientName = request.client
    ? `${request.client.firstName} ${request.client.lastName}`.trim()
    : "The client";
  const { outcome } = request;
  const href = request.itemId
    ? workItemHref(request.project.id, request.itemId, "ADMIN", "list")
    : `/admin/projects/${request.project.id}`;

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
        <Link href={href} className="hover:text-primary">
          {request.title}
        </Link>
      </h3>
      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
        {request.client && (
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
        )}
        <Link
          href={`/admin/projects/${request.project.id}`}
          className="flex min-w-0 items-center gap-1 hover:text-primary"
        >
          <FolderKanban className="size-3 shrink-0" />
          <span className="truncate">{request.project.projectName}</span>
        </Link>
        <p className="flex flex-wrap items-center gap-x-2 tabular-nums">
          <span>
            {formatDate(request.createdAt)}
            {request.resolvedAt && ` → ${formatDate(request.resolvedAt)}`}
            {outcome.kind === "waiting" && !stale && waitingDays > 0 && ` · ${waitingDays}d waiting`}
          </span>
          {request.comments > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3" /> {request.comments}
            </span>
          )}
        </p>
      </div>

      {request.description !== undefined && (
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
      )}

      {outcome.kind === "accepted" && (
        <p className="mt-2.5">
          <SoftPill color={COLUMN_BY_ID[outcome.stage].color}>{requestLabel(outcome, "ADMIN")}</SoftPill>
        </p>
      )}
      {outcome.kind === "closed" && (
        <p className="mt-2.5 text-xs text-muted-foreground">{requestLabel(outcome, "ADMIN")}</p>
      )}
      {outcome.kind === "declined" && outcome.note && (
        <p className="mt-2.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">
          <span className="font-medium">Note:</span> {outcome.note}
        </p>
      )}
      {outcome.kind === "withdrawn" && (
        <p className="mt-2.5 text-xs text-muted-foreground">Withdrawn by {clientName}.</p>
      )}

      {outcome.kind === "waiting" && request.requestId && (
        <div className="mt-3 border-t pt-3">
          <RequestReviewActions
            request={{
              id: request.requestId,
              title: request.title,
              clientName,
              projectId: request.project.id,
              billingType: request.project.billingType,
              itemId: request.itemId,
              role,
            }}
          />
        </div>
      )}
    </article>
  );
}
