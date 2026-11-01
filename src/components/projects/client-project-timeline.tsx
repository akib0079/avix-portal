"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { COLUMN_BY_ID, type WorkItem } from "@/lib/board";
import { formatPricing } from "@/lib/format";
import { formatHours, phaseProgress, planTree } from "@/lib/work-list";
import { projectHealth } from "@/lib/project-health";
import { useWork } from "@/components/board/work-store";
import { formatDay } from "@/components/board/board-bits";
import { RateMilestone } from "@/components/portal/rate-milestone";
import { ItemDetails } from "@/components/milestones/item-details";
import { SoftPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  BadgeDollarSign,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Clock,
  Eye,
  Inbox,
  LoaderCircle,
  PanelRightOpen,
  Undo2,
} from "lucide-react";

/**
 * The client's list: the plan as they follow it — top-level work in order,
 * how far along each part is, what it costs (their own prices, never on a
 * fixed contract), and the one thing each item may be waiting for from them:
 * approve or send back work in review, rate finished work. What they asked
 * for and the team hasn't decided yet waits above the plan, "Waiting for the
 * team". Same items as their board, from the same store.
 */
export function ClientWorkList({ switcher }: { switcher?: ReactNode }) {
  const work = useWork();
  const tree = useMemo(() => planTree(work.items), [work.items]);
  const health = projectHealth({ milestones: work.items, status: "IN_PROGRESS" });

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          {health.total === 0
            ? "Nothing scheduled yet"
            : `${health.done} of ${health.total} milestone${health.total === 1 ? "" : "s"} done`}
        </p>
        <div className="ml-auto">{switcher}</div>
      </div>

      {tree.requested.length > 0 && <Waiting items={tree.requested} />}

      {tree.rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Milestones will appear here once the project is scoped.
        </p>
      ) : (
        <ol className="relative space-y-0 rounded-2xl border bg-card p-4 sm:p-6">
          {tree.rows.map((row, index) => (
            <TimelineRow
              key={row.item.id}
              item={row.item}
              subItems={row.children}
              last={index === tree.rows.length - 1}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

/** Their asks the team hasn't decided yet. Their own ones they can still change or withdraw. */
function Waiting({ items }: { items: WorkItem[] }) {
  const work = useWork();
  const color = COLUMN_BY_ID.REQUESTED.color;
  return (
    <section
      aria-label="Waiting for the team"
      className="mb-5 rounded-2xl border border-[color-mix(in_oklab,var(--col)_35%,var(--border))] bg-[color-mix(in_oklab,var(--col)_6%,var(--card))] p-3"
      style={{ "--col": color } as CSSProperties}
    >
      <h3 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold">
        <Inbox className="size-4 text-[color-mix(in_oklab,var(--col)_80%,var(--foreground))]" /> Waiting for the team
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">{items.length}</span>
      </h3>
      <ul className="space-y-2">
        {items.map((item) => {
          const mine = item.createdById === work.viewer.id;
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-3 py-2.5">
              <button type="button" onClick={() => work.open(item.id)} className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-medium [overflow-wrap:anywhere] hover:text-primary">{item.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Asked {formatDay(item.createdAt.slice(0, 10), work.today)} — the team will accept it into
                  the plan or get back to you.
                </span>
              </button>
              {mine && (
                <span className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => work.open(item.id)}>
                    <PanelRightOpen /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void work.withdraw(item.id)}>
                    <Undo2 /> Withdraw
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StageIcon({ stage }: { stage: WorkItem["stage"] }) {
  if (stage === "DONE") {
    return (
      <span className="flex size-7 items-center justify-center rounded-full bg-success text-white">
        <Check className="size-4" />
      </span>
    );
  }
  if (stage === "REVIEW") {
    return (
      <span
        className="flex size-7 items-center justify-center rounded-full text-white"
        style={{ background: COLUMN_BY_ID.REVIEW.color }}
      >
        <Eye className="size-4" />
      </span>
    );
  }
  if (stage === "IN_PROGRESS") {
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

/** Approve or send back — the verdict a client gives on work the team sent for review. */
function ReviewButtons({ item }: { item: WorkItem }) {
  const work = useWork();
  const [busy, setBusy] = useState(false);
  if (item.stage !== "REVIEW" || item.archivedAt) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await work.move(item.id, "DONE");
          setBusy(false);
        }}
      >
        {busy ? <LoaderCircle className="animate-spin" /> : <Check />} Approve
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => work.sendBack(item.id)}>
        <Undo2 /> Send back
      </Button>
    </div>
  );
}

function TimelineRow({ item, subItems, last }: { item: WorkItem; subItems: WorkItem[]; last: boolean }) {
  const work = useWork();
  // Work waiting for the client's review inside a phase opens it, so the
  // buttons are in sight; otherwise the phase stays folded to its summary.
  const [open, setOpen] = useState(() => subItems.some((c) => c.stage === "REVIEW"));
  const pricing = work.pricesShown ? formatPricing(item) : null;
  const finished = item.stage === "DONE";
  const progress = phaseProgress(subItems);
  const column = COLUMN_BY_ID[item.stage];

  return (
    <li className="relative flex gap-4 pb-8 last:pb-0">
      {!last && (
        <span
          aria-hidden
          className={cn(
            "absolute top-8 left-[13px] h-[calc(100%-2rem)] w-0.5",
            finished ? "bg-success/40" : "bg-border",
          )}
        />
      )}
      <div className="relative z-10 shrink-0 pt-0.5">
        <StageIcon stage={item.stage} />
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => work.open(item.id)}
            className={cn(
              "text-left font-medium [overflow-wrap:anywhere] hover:text-primary",
              finished && "text-muted-foreground",
            )}
          >
            {item.title}
          </button>
          <SoftPill color={column.color}>{column.clientLabel}</SoftPill>
        </div>
        {pricing && (
          <p className="mt-1 flex items-center gap-1 text-xs font-medium text-primary">
            <BadgeDollarSign className="size-3.5" /> {pricing}
          </p>
        )}
        {item.loggedHours > 0 && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            {formatHours(item.loggedHours)} worked
          </p>
        )}

        {subItems.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              <span className="tabular-nums">
                {progress.done} of {progress.total} done
              </span>
              <span className="h-1 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${progress.percent}%`, background: COLUMN_BY_ID.DONE.color }}
                />
              </span>
            </button>
            {open && (
              <ul className="mt-2 space-y-2 border-l-2 border-dashed border-border pl-3">
                {subItems.map((child) => {
                  const childColumn = COLUMN_BY_ID[child.stage];
                  return (
                    <li key={child.id}>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => work.open(child.id)}
                          className={cn(
                            "text-left text-sm [overflow-wrap:anywhere] hover:text-primary",
                            child.stage === "DONE" && "text-muted-foreground line-through decoration-1",
                          )}
                        >
                          {child.title}
                        </button>
                        <SoftPill color={childColumn.color} className="text-[11px]">
                          {childColumn.clientLabel}
                        </SoftPill>
                      </div>
                      <ReviewButtons item={child} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {(item.hasDescription || item.loggedHours > 0) && (
          <ItemDetails itemId={item.id} hasDescription={item.hasDescription} showNotes className="mt-2" />
        )}
        <ReviewButtons item={item} />
        {finished && (
          <RateMilestone milestoneId={item.id} rating={item.clientRating} note={item.clientRatingNote} />
        )}
      </div>
    </li>
  );
}
