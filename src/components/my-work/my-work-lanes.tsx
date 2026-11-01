"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import type { ProjectTaskStatus } from "@prisma/client";
import { toast } from "sonner";
import type { MyWorkItem } from "@/lib/dal/my-work";
import { BOARD_COLUMNS, COLUMN_BY_ID, PRIORITY_META, workItemHref, type WorkRole } from "@/lib/board";
import { moveWorkItem } from "@/lib/actions/project-board";
import { dueBucket, formatHours, stageChoices, type DueBucket } from "@/lib/work-list";
import { HUE } from "@/lib/status-colors";
import { formatDate } from "@/lib/format";
import { Lane, LaneScroller } from "@/components/ui/lanes";
import { AcceptRequestDialog, DeclineRequestDialog } from "@/components/board/work-dialogs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toneText } from "@/lib/tone";
import {
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  Flag,
  LifeBuoy,
  Loader2,
  X,
} from "lucide-react";

const BUCKETS: { name: DueBucket; color: string }[] = [
  { name: "Overdue", color: HUE.red },
  { name: "Today", color: HUE.brand },
  { name: "This week", color: HUE.blue },
  { name: "Later", color: HUE.sky },
  { name: "No date", color: HUE.slate },
];

/**
 * My Work as lanes by when it's due — every project's work with this
 * person's name on it, one list since the board cards and the milestones
 * became the same rows. Each card moves along from here (the stage chip
 * offers exactly the moves the project's board would), and a client's
 * request pinned on this person is accepted or declined in place.
 */
export function MyWorkLanes({
  items,
  today,
  role,
}: {
  items: MyWorkItem[];
  /** The calendar day the server bucketed by, so both renders agree. */
  today: string;
  role: WorkRole;
}) {
  // Optimistic stages, until the next load brings the rows back.
  const [moved, setMoved] = useState<Record<string, ProjectTaskStatus>>({});
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const live = items
    .filter((i) => !gone.has(i.id))
    .map((i) => (moved[i.id] ? { ...i, stage: moved[i.id]! } : i));

  const grouped = new Map<DueBucket, MyWorkItem[]>();
  for (const item of live) {
    const bucket = dueBucket(item.dueDate, today);
    grouped.set(bucket, [...(grouped.get(bucket) ?? []), item]);
  }
  // Soonest first inside each lane; undated items keep their source order.
  for (const list of grouped.values()) {
    list.sort((a, b) => (a.dueDate ?? "￿").localeCompare(b.dueDate ?? "￿"));
  }

  async function move(item: MyWorkItem, stage: ProjectTaskStatus) {
    setMoved((m) => ({ ...m, [item.id]: stage }));
    // No position: the item goes to the end of its new column on the board.
    const result = await moveWorkItem({ itemId: item.id, stage });
    if (!result.ok) {
      setMoved((m) => {
        const next = { ...m };
        delete next[item.id];
        return next;
      });
      return void toast.error(result.error);
    }
    toast.success(
      stage === "DONE"
        ? `Done — “${item.title}”`
        : `${item.title} → ${COLUMN_BY_ID[stage].label}`,
    );
  }

  return (
    <LaneScroller>
      {BUCKETS.filter((b) => grouped.has(b.name)).map((b) => {
        const list = grouped.get(b.name)!;
        return (
          <Lane key={b.name} color={b.color} title={b.name} count={list.length} className="lg:min-w-[250px]">
            {list.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                overdue={b.name === "Overdue"}
                role={role}
                onMove={(stage) => move(item, stage)}
                // Accepted, it's still this person's — now in the stage they picked.
                onAccepted={(stage) => setMoved((m) => ({ ...m, [item.id]: stage }))}
                // Declined, it isn't anyone's work any more.
                onDeclined={() => setGone((prev) => new Set(prev).add(item.id))}
              />
            ))}
          </Lane>
        );
      })}
    </LaneScroller>
  );
}

function ItemCard({
  item,
  overdue,
  role,
  onMove,
  onAccepted,
  onDeclined,
}: {
  item: MyWorkItem;
  overdue: boolean;
  role: WorkRole;
  onMove: (stage: ProjectTaskStatus) => Promise<void>;
  onAccepted: (stage: ProjectTaskStatus) => void;
  onDeclined: () => void;
}) {
  const [deciding, setDeciding] = useState<"accept" | "decline" | null>(null);
  const column = COLUMN_BY_ID[item.stage];
  const done = item.stage === "DONE";
  const choices = stageChoices(role, { stage: item.stage, archivedAt: null });
  const href = workItemHref(item.projectId, item.id, "ADMIN");

  return (
    <div
      style={{ "--col": column.color } as CSSProperties}
      className="group/card relative overflow-hidden rounded-xl border bg-card p-3 shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-[box-shadow,border-color] duration-150 hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] hover:shadow-[0_6px_20px_-10px_rgb(15_23_42/0.25)]"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />

      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {/* Where it stands, in the board's colours — and the way to move it on. */}
        <StageChip stage={item.stage} choices={choices} onMove={onMove} />
        {item.clientNeedsHelp && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/12 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-red-600 uppercase dark:text-red-400">
            <LifeBuoy className="size-3" /> Needs help
          </span>
        )}
      </div>

      <Link
        href={href}
        className={cn(
          "line-clamp-2 text-[13px] leading-snug font-semibold [overflow-wrap:anywhere] outline-none hover:text-primary focus-visible:underline",
          done && "text-muted-foreground line-through decoration-1",
        )}
      >
        {item.title}
      </Link>
      <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
        <Building2 className="size-3 shrink-0" />
        <span className="truncate">
          {item.projectName}
          {item.clientName ? ` · ${item.clientName}` : ""}
        </span>
      </p>

      {(item.dueDate || item.priority || item.loggedHours > 0 || item.estimatedHours != null) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
          {item.priority && (
            <span
              className="inline-flex items-center gap-1 font-medium"
              style={{ color: PRIORITY_META[item.priority].color }}
            >
              <Flag className="size-3" fill="currentColor" />
              {PRIORITY_META[item.priority].label}
            </span>
          )}
          {item.dueDate && (
            <span
              className={cn(
                "inline-flex items-center gap-1 tabular-nums",
                overdue && !done ? cn("font-medium", toneText.bad) : "text-muted-foreground",
              )}
            >
              <CalendarClock className="size-3" />
              {formatDate(item.dueDate)}
            </span>
          )}
          {(item.loggedHours > 0 || item.estimatedHours != null) && (
            <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
              <Clock className="size-3" />
              {formatHours(item.loggedHours)}
              {item.estimatedHours != null ? ` / ${formatHours(item.estimatedHours)}` : ""}
            </span>
          )}
        </div>
      )}

      {item.stage === "REQUESTED" && item.sourceTaskRequestId && (
        <div className="mt-2.5 flex gap-1.5 border-t pt-2.5">
          <button
            type="button"
            onClick={() => setDeciding("accept")}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
          >
            <Check className="size-3.5" /> Accept
          </button>
          <button
            type="button"
            onClick={() => setDeciding("decline")}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border bg-background px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" /> Decline
          </button>
        </div>
      )}

      {deciding === "accept" && item.sourceTaskRequestId && (
        <AcceptRequestDialog
          open
          onOpenChange={(o) => !o && setDeciding(null)}
          requestId={item.sourceTaskRequestId}
          title={item.title}
          clientName={item.clientName}
          projectId={item.projectId}
          role={role}
          billingType={item.projectBillingType}
          itemId={item.id}
          onAccepted={(choice) => onAccepted(choice.stage)}
        />
      )}
      {deciding === "decline" && item.sourceTaskRequestId && (
        <DeclineRequestDialog
          open
          onOpenChange={(o) => !o && setDeciding(null)}
          requestId={item.sourceTaskRequestId}
          title={item.title}
          clientName={item.clientName}
          onDeclined={onDeclined}
        />
      )}
    </div>
  );
}

function StageChip({
  stage,
  choices,
  onMove,
}: {
  stage: ProjectTaskStatus;
  choices: ProjectTaskStatus[];
  onMove: (stage: ProjectTaskStatus) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const column = COLUMN_BY_ID[stage];
  const chip = (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--col)_13%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[color-mix(in_oklab,var(--col)_72%,var(--foreground))]"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--col)]" />
      {column.label}
      {busy ? <Loader2 className="size-3 animate-spin" /> : choices.length > 0 && <ChevronDown className="size-3 opacity-70" />}
    </span>
  );
  if (choices.length === 0) return chip;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={`Stage: ${column.label}. Change stage`}
        >
          {chip}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {BOARD_COLUMNS.filter((c) => c.id === stage || choices.includes(c.id)).map((c) => (
          <DropdownMenuItem
            key={c.id}
            disabled={c.id === stage}
            onSelect={async () => {
              if (c.id === stage) return;
              setBusy(true);
              await onMove(c.id);
              setBusy(false);
            }}
          >
            <span className="size-2.5 rounded-full" style={{ background: c.color }} />
            <span className="flex-1">{c.label}</span>
            {c.id === stage && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
