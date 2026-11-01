"use client";

import { memo, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import { formatDistanceToNow } from "date-fns";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { BOARD_COLUMNS, COLUMN_BY_ID, type BoardPerson, type WorkItem } from "@/lib/board";
import { reorderMilestones } from "@/lib/actions/milestones";
import {
  LIST_GROUPINGS,
  assigneeGroups,
  formatHours,
  phaseProgress,
  planOrder,
  planTree,
  priceLabel,
  reorderPlan,
  stageChoices,
  stageGroups,
  withPlanPositions,
  type ItemGroup,
  type ListGrouping,
  type PlanRow,
  type PlanTree,
} from "@/lib/work-list";
import { useLocalChoice, useLocalSet } from "@/lib/use-local-pref";
import { useWork, type WorkStore } from "@/components/board/work-store";
import { DueChip, HoursBar, PersonAvatar, PriorityFlag, formatDay } from "@/components/board/board-bits";
import { LanePill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Archive,
  ArchiveRestore,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock,
  GripVertical,
  Inbox,
  LifeBuoy,
  ListPlus,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PanelRightOpen,
  Plus,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  X,
} from "lucide-react";

/**
 * The Milestones list — the plan, read top to bottom. Same items as the
 * board, from the same store, so a drag there shows here at once.
 *
 *  - Plan: the project's order, phases as parent rows with their work
 *    indented and foldable ("3/5 done"), reordered by dragging.
 *  - Stage: the board turned on its side.
 *  - Assignee: who's on what, and what has nobody.
 *
 * A client's requests are pinned above the plan until they're accepted or
 * declined, right there. Every row shows where the work stands at a glance —
 * stage in the board's colours (click to move it), who, when, what it costs
 * (admins), hours against the estimate, the client's verdict, the thread —
 * and its actions sit in one menu.
 */

const GROUP_LABELS: Record<ListGrouping, string> = { plan: "Plan", stage: "Stage", assignee: "Assignee" };

/**
 * What a row needs from the store — only the parts that rarely change, so a
 * row re-renders when its own item does, not whenever any item does.
 */
type RowCtx = Pick<
  WorkStore,
  "viewer" | "people" | "today" | "pricesShown" | "open" | "move" | "patch" | "logTime" | "create" | "archive"
>;

function useRowCtx(work: WorkStore): RowCtx {
  const { viewer, people, today, pricesShown, open, move, patch, logTime, create, archive } = work;
  return useMemo(
    () => ({ viewer, people, today, pricesShown, open, move, patch, logTime, create, archive }),
    [viewer, people, today, pricesShown, open, move, patch, logTime, create, archive],
  );
}

const archiveFetcher = (url: string) =>
  fetch(url).then((r) => (r.ok ? (r.json() as Promise<{ items: WorkItem[] }>) : null));

export function MilestoneList({ switcher }: { switcher?: ReactNode }) {
  const work = useWork();
  const { viewer, items, people } = work;
  const [grouping, setGrouping] = useLocalChoice<ListGrouping>("avix.work.group", "plan", LIST_GROUPINGS);
  const [folded, toggleFold] = useLocalSet("avix.work.folded");
  const [showArchived, setShowArchived] = useState(false);
  const archive = useSWR(
    showArchived ? `/api/projects/${work.projectId}/board?archived=1` : null,
    archiveFetcher,
    { revalidateOnFocus: false },
  );

  const ctx = useRowCtx(work);
  const tree = useMemo(() => planTree(items), [items]);
  const accepted = items.filter((i) => i.stage !== "REQUESTED");
  const done = accepted.filter((i) => i.stage === "DONE").length;

  return (
    <div className="min-w-0">
      {/* Toolbar: how to read it, and what's hidden. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Group by" className="inline-flex shrink-0 rounded-lg border bg-card p-0.5">
          {LIST_GROUPINGS.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={grouping === g}
              onClick={() => setGrouping(g)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                grouping === g ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {GROUP_LABELS[g]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          aria-pressed={showArchived}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
            showArchived ? "bg-muted text-foreground" : "bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          <Archive className="size-3.5" /> {showArchived ? "Hide archived" : "Show archived"}
        </button>
        <div className="ml-auto flex items-center gap-2">
          {accepted.length > 0 && (
            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
              {done}/{accepted.length} done
            </span>
          )}
          {switcher}
          <Button onClick={() => work.create({ stage: "TODO" })} className="shrink-0">
            <Plus /> Add milestone
          </Button>
        </div>
      </div>

      {tree.requested.length > 0 && <RequestedSection items={tree.requested} work={work} />}

      {accepted.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
          <p className="font-medium">No milestones yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Add the first step of this project. The client follows the same list from their portal.
          </p>
          <Button onClick={() => work.create({ stage: "TODO" })} className="mt-4">
            <Plus /> Add the first milestone
          </Button>
        </div>
      ) : grouping === "plan" ? (
        <PlanList tree={tree} folded={folded} onToggle={toggleFold} work={work} ctx={ctx} />
      ) : (
        <GroupedList
          groups={grouping === "stage" ? stageGroups(items, viewer.side) : assigneeGroups(items, people)}
          by={grouping}
          items={items}
          ctx={ctx}
        />
      )}

      {showArchived && (
        <ArchivedSection
          items={archive.data?.items ?? null}
          loading={archive.isLoading}
          work={work}
          onRestored={() => void archive.mutate()}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Requested                                                            */
/* -------------------------------------------------------------------- */

/** The client's asks, pinned above the plan until each is decided — here, in place. */
function RequestedSection({ items, work }: { items: WorkItem[]; work: WorkStore }) {
  const color = COLUMN_BY_ID.REQUESTED.color;
  const clientName = work.people.find((p) => p.role === "CLIENT")?.name ?? "The client";
  return (
    <section
      aria-label="Requested"
      className="mb-5 rounded-2xl border border-[color-mix(in_oklab,var(--col)_35%,var(--border))] bg-[color-mix(in_oklab,var(--col)_6%,var(--card))] p-3"
      style={{ "--col": color } as CSSProperties}
    >
      <header className="mb-2 flex flex-wrap items-center gap-2 px-1">
        <LanePill color={color}>
          <Inbox className="size-3.5" /> Requested
        </LanePill>
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">{items.length}</span>
        <span className="text-xs text-muted-foreground">Accept each into the plan, or decline it with a note.</span>
      </header>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-3 py-2.5 shadow-[0_1px_2px_rgb(15_23_42/0.05)]"
          >
            <button
              type="button"
              onClick={() => work.open(item.id)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block text-sm font-medium [overflow-wrap:anywhere] hover:text-primary">{item.title}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {item.creatorName ?? clientName} · asked {formatDay(item.createdAt.slice(0, 10), work.today)}
                {item.commentCount > 0 ? ` · ${item.commentCount} comment${item.commentCount === 1 ? "" : "s"}` : ""}
              </span>
            </button>
            {item.sourceTaskRequestId && (
              <span className="flex shrink-0 gap-1.5 max-sm:w-full">
                <Button size="sm" className="max-sm:flex-1" onClick={() => work.accept(item.id)}>
                  <Check /> Accept
                </Button>
                <Button size="sm" variant="outline" className="max-sm:flex-1" onClick={() => work.decline(item.id)}>
                  <X /> Decline
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------- */
/* The plan                                                             */
/* -------------------------------------------------------------------- */

function PlanList({
  tree,
  folded,
  onToggle,
  work,
  ctx,
}: {
  tree: PlanTree;
  folded: Set<string>;
  onToggle: (id: string) => void;
  work: WorkStore;
  ctx: RowCtx;
}) {
  const rows = tree.rows;
  // Distance for the mouse, a long-press for touch — a swipe must scroll
  // the page on a phone, not pick a row up.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Which sibling group each row drags within: the top level, or one phase.
  const groupOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(r.item.id, "");
      for (const c of r.children) map.set(c.id, r.item.id);
    }
    return map;
  }, [rows]);
  // Rows only ever land among their own siblings, so only those are targets.
  const collisions: CollisionDetection = (args) => {
    const group = groupOf.get(String(args.active.id));
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => groupOf.get(String(c.id)) === group),
    });
  };

  async function onDragEnd(event: DragEndEvent) {
    work.endDrag();
    const { active, over } = event;
    if (!over) return;
    const next = reorderPlan(tree, String(active.id), String(over.id));
    if (!next) return;
    const order = planOrder(next);
    const before = work.itemsRef.current;
    work.setItems((prev) => withPlanPositions(prev, order));
    const result = await work.track(() => reorderMilestones(work.projectId, order));
    if (!result.ok) {
      work.setItems(before);
      toast.error(result.error);
      work.refresh();
    }
  }

  return (
    // Stable id keeps dnd-kit's aria ids identical between server and client.
    <DndContext
      id={`plan-${work.projectId}`}
      sensors={sensors}
      collisionDetection={collisions}
      // The poll holds off while a row is in the air, as on the board.
      onDragStart={() => void work.beginDrag()}
      onDragEnd={onDragEnd}
      onDragCancel={work.endDrag}
    >
      <SortableContext items={rows.map((r) => r.item.id)} strategy={verticalListSortingStrategy}>
        <ol className="space-y-2">
          {rows.map((row, index) => (
            <SortablePlanRow
              key={row.item.id}
              row={row}
              index={index}
              folded={folded.has(row.item.id)}
              onToggle={onToggle}
              ctx={ctx}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

/** A top-level row, and when it's a phase, the work under it — they drag as one. */
const SortablePlanRow = memo(function SortablePlanRow({
  row,
  index,
  folded,
  onToggle,
  ctx,
}: {
  row: PlanRow;
  index: number;
  folded: boolean;
  onToggle: (id: string) => void;
  ctx: RowCtx;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.item.id });
  const phase = row.children.length > 0;
  const progress = phaseProgress(row.children);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10")}
    >
      <ListRow
        item={row.item}
        ctx={ctx}
        dragging={isDragging}
        lead={
          <>
            <DragHandle attributes={attributes} listeners={listeners} />
            <span className="hidden w-5 shrink-0 text-center text-xs font-semibold text-muted-foreground tabular-nums sm:block">
              {index + 1}
            </span>
          </>
        }
        phase={
          phase ? (
            <button
              type="button"
              onClick={() => onToggle(row.item.id)}
              aria-expanded={!folded}
              aria-label={folded ? `Show the work in ${row.item.title}` : `Fold ${row.item.title}`}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {folded ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              <span className="tabular-nums">
                {progress.done}/{progress.total} done
              </span>
              <span className="h-1 w-12 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className="block h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${progress.percent}%`, background: COLUMN_BY_ID.DONE.color }}
                />
              </span>
            </button>
          ) : null
        }
      />
      {phase && !folded && (
        <SortableContext items={row.children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ol className="mt-1.5 ml-4 space-y-1.5 border-l-2 border-dashed border-border pl-3 sm:ml-9">
            {row.children.map((child) => (
              <SortableChildRow key={child.id} item={child} ctx={ctx} />
            ))}
          </ol>
        </SortableContext>
      )}
    </li>
  );
}, samePlanRow);

/**
 * planTree builds fresh row objects whenever any item changes; the items
 * inside keep their identity (the store reconciles them), so compare those.
 */
function samePlanRow(
  a: { row: PlanRow; index: number; folded: boolean; onToggle: unknown; ctx: RowCtx },
  b: { row: PlanRow; index: number; folded: boolean; onToggle: unknown; ctx: RowCtx },
) {
  return (
    a.row.item === b.row.item &&
    a.row.children.length === b.row.children.length &&
    a.row.children.every((c, i) => c === b.row.children[i]) &&
    a.index === b.index &&
    a.folded === b.folded &&
    a.onToggle === b.onToggle &&
    a.ctx === b.ctx
  );
}

const SortableChildRow = memo(function SortableChildRow({ item, ctx }: { item: WorkItem; ctx: RowCtx }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10")}
    >
      <ListRow
        item={item}
        ctx={ctx}
        compact
        dragging={isDragging}
        lead={<DragHandle attributes={attributes} listeners={listeners} />}
      />
    </li>
  );
});

function DragHandle({
  attributes,
  listeners,
}: {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
}) {
  return (
    <button
      type="button"
      className="shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground active:cursor-grabbing"
      aria-label="Drag to reorder"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-4" />
    </button>
  );
}

/* -------------------------------------------------------------------- */
/* Grouped by stage or assignee                                         */
/* -------------------------------------------------------------------- */

function GroupedList({
  groups,
  by,
  items,
  ctx,
}: {
  groups: ItemGroup[];
  by: ListGrouping;
  items: WorkItem[];
  ctx: RowCtx;
}) {
  const titles = useMemo(() => new Map(items.map((i) => [i.id, i.title])), [items]);
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <header className="mb-2 flex items-center gap-2 px-1">
            {by === "stage" && group.color ? (
              <LanePill color={group.color}>{group.label}</LanePill>
            ) : (
              <span className="flex items-center gap-2 text-sm font-semibold">
                <PersonAvatar person={group.person} size={22} />
                {group.label}
              </span>
            )}
            <span className="text-xs font-semibold text-muted-foreground tabular-nums">{group.items.length}</span>
          </header>
          <ol className="space-y-1.5">
            {group.items.map((item) => (
              <li key={item.id}>
                <ListRow
                  item={item}
                  ctx={ctx}
                  parentTitle={item.parentId ? titles.get(item.parentId) : undefined}
                />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Archive                                                              */
/* -------------------------------------------------------------------- */

function ArchivedSection({
  items,
  loading,
  work,
  onRestored,
}: {
  items: WorkItem[] | null;
  loading: boolean;
  work: WorkStore;
  onRestored: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  // Declined and withdrawn requests stay in the archive as a record; only
  // accepted work comes back.
  const list = (items ?? []).filter((i) => i.archivedAt);
  return (
    <section aria-label="Archived" className="mt-8">
      <h3 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-muted-foreground">
        <Archive className="size-4" /> Archived {items ? `· ${list.length}` : ""}
      </h3>
      {loading && !items ? (
        <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading the archive…
        </p>
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing archived. Archiving hides an item from the plan and keeps its hours, invoices and thread.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((item) => {
            const request = item.stage === "REQUESTED";
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-dashed bg-card/60 px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => work.open(item.id)}
                  className="min-w-0 flex-1 text-left text-sm text-muted-foreground hover:text-foreground"
                >
                  <span className="[overflow-wrap:anywhere]">{item.title}</span>
                  <span className="ml-2 text-xs">
                    {request ? "Declined or withdrawn request" : COLUMN_BY_ID[item.stage].label}
                    {item.archivedAt ? ` · archived ${formatDistanceToNow(new Date(item.archivedAt), { addSuffix: true })}` : ""}
                  </span>
                </button>
                {!request && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === item.id}
                    onClick={async () => {
                      setBusyId(item.id);
                      const restored = await work.restore(item.id);
                      setBusyId(null);
                      if (restored) onRestored();
                    }}
                  >
                    {busyId === item.id ? <Loader2 className="animate-spin" /> : <ArchiveRestore />} Restore
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------- */
/* A row                                                                */
/* -------------------------------------------------------------------- */

/**
 * One piece of work. Line one: where it stands and what it is; line two (a
 * phone) or the same line (wider): who, when, cost, hours, the client's
 * verdict and the thread. Memoised on the item: the store keeps unchanged
 * items identical, so a poll or a drag re-renders only the rows that moved.
 */
const ListRow = memo(function ListRow({
  item,
  ctx,
  lead,
  phase,
  compact,
  dragging,
  parentTitle,
}: {
  item: WorkItem;
  ctx: RowCtx;
  /** The drag handle and number, in the plan. */
  lead?: ReactNode;
  /** A phase's fold toggle and progress. */
  phase?: ReactNode;
  /** A phase's own work, indented under it. */
  compact?: boolean;
  dragging?: boolean;
  /** Grouped views lose the indent, so a sub-item names its phase. */
  parentTitle?: string;
}) {
  const { viewer, today } = ctx;
  const column = COLUMN_BY_ID[item.stage];
  const assignee = item.assigneeId ? ctx.people.find((p) => p.id === item.assigneeId) : undefined;
  const done = item.stage === "DONE";
  const price = viewer.role === "ADMIN" && ctx.pricesShown ? priceLabel(item) : null;
  const help = item.openHelp.client + item.openHelp.team;
  const helpForUs = item.openHelp.client > 0;

  return (
    <div
      className={cn(
        "group/row relative flex flex-wrap items-center gap-x-2 gap-y-1.5 overflow-hidden rounded-xl border bg-card py-2 pr-2 pl-2.5 shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-[box-shadow,border-color] duration-150 hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] sm:flex-nowrap",
        compact && "py-1.5",
        dragging && "border-[color-mix(in_oklab,var(--col)_55%,var(--border))] shadow-[0_22px_45px_-18px_rgb(15_23_42/0.45)]",
        helpForUs && "border-red-400/50",
      )}
      style={{ "--col": column.color } as CSSProperties}
    >
      {/* Stage colour on the leading edge, as on the board. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />
      {lead}
      <StageMenu item={item} ctx={ctx} />
      <button
        type="button"
        onClick={() => ctx.open(item.id)}
        className={cn(
          "min-w-0 flex-1 text-left text-sm font-medium [overflow-wrap:anywhere] hover:text-primary sm:truncate",
          compact && "font-normal",
          done && "text-muted-foreground line-through decoration-1",
        )}
        title={item.title}
      >
        {item.title}
      </button>

      {/* Facts: their own line on a phone, beside the title on wider screens. */}
      <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs max-sm:order-last max-sm:basis-full max-sm:pl-8 sm:max-w-[60%] sm:shrink-0 sm:justify-end">
        {phase}
        {parentTitle && (
          <span className="max-w-[10rem] truncate rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {parentTitle}
          </span>
        )}
        {item.createdByRole === "CLIENT" && (
          <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
            From client
          </span>
        )}
        <PriorityFlag priority={item.priority} />
        <DueChip day={item.dueDate} done={done} today={today} />
        {price && (
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-primary tabular-nums">{price}</span>
        )}
        {(item.loggedHours > 0 || item.estimatedHours != null) && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground tabular-nums" title="Hours logged">
            <Clock className="size-3" />
            {formatHours(item.loggedHours)}
            {item.estimatedHours != null ? ` / ${formatHours(item.estimatedHours)}` : ""}
            <HoursBar logged={item.loggedHours} estimate={item.estimatedHours} className="w-10" />
          </span>
        )}
        {item.clientApprovedAt && (
          <span title="Approved by the client" className="text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-3.5" aria-label="Approved by the client" />
          </span>
        )}
        {item.clientRating != null && (
          <span
            title={item.clientRatingNote ? `“${item.clientRatingNote}”` : "Rated by the client"}
            className={item.clientRating === 1 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}
          >
            {item.clientRating === 1 ? (
              <ThumbsUp className="size-3.5" aria-label="Client rated it a thumbs up" />
            ) : (
              <ThumbsDown className="size-3.5" aria-label="Client rated it a thumbs down" />
            )}
          </span>
        )}
        {item.commentCount > 0 && (
          <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
            <MessageSquare className="size-3" />
            {item.commentCount}
          </span>
        )}
        {help > 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
              helpForUs ? "bg-red-500/12 text-red-600 dark:text-red-400" : "bg-amber-500/12 text-amber-700 dark:text-amber-300",
            )}
            title={helpForUs ? "The client asked for help" : "Waiting on the client's answer"}
          >
            <LifeBuoy className="size-3" />
            {help}
          </span>
        )}
        {item.billedOn.map((b) => (
          <Link
            key={b.invoiceId}
            href={`/admin/invoices/${b.invoiceId}`}
            className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
          >
            Billed {b.invoiceNumber}
          </Link>
        ))}
        <span className="inline-flex items-center gap-1.5 text-muted-foreground" title={assignee?.name ?? "Nobody yet"}>
          <PersonAvatar person={assignee ?? null} size={20} />
          <span className="hidden max-w-[7rem] truncate lg:inline">{assignee?.name.split(" ")[0] ?? ""}</span>
        </span>
      </span>
      <RowMenu item={item} ctx={ctx} />
    </div>
  );
});

/** The stage chip: the board's colour and word; click to move it, as far as the rules allow. */
function StageMenu({ item, ctx }: { item: WorkItem; ctx: RowCtx }) {
  const column = COLUMN_BY_ID[item.stage];
  const choices = stageChoices(ctx.viewer.role, item);
  const chip = (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--c)_13%,transparent)] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-[color-mix(in_oklab,var(--c)_72%,var(--foreground))]"
      style={{ "--c": column.color } as CSSProperties}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--c)]" />
      {column.label}
      {choices.length > 0 && <ChevronDown className="size-3 opacity-70" />}
    </span>
  );
  if (choices.length === 0) return chip;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label={`Stage: ${column.label}. Change stage`}>
          {chip}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <StageItems item={item} ctx={ctx} choices={choices} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StageItems({ item, ctx, choices }: { item: WorkItem; ctx: RowCtx; choices: WorkItem["stage"][] }) {
  return (
    <>
      {BOARD_COLUMNS.filter((c) => c.id === item.stage || choices.includes(c.id)).map((c) => (
        <DropdownMenuItem
          key={c.id}
          disabled={c.id === item.stage}
          onSelect={() => c.id !== item.stage && void ctx.move(item.id, c.id)}
        >
          <span className="size-2.5 rounded-full" style={{ background: c.color }} />
          <span className="flex-1">{c.label}</span>
          {c.id === item.stage && <Check className="size-4 text-primary" />}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** Everything else a row can do, in one menu: the brief's stage, assign, log time, edit, archive. */
function RowMenu({ item, ctx }: { item: WorkItem; ctx: RowCtx }) {
  const choices = stageChoices(ctx.viewer.role, item);
  const topLevel = !item.parentId;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="ml-auto shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:ml-0"
          aria-label={`Actions for ${item.title}`}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => ctx.open(item.id)}>
          <PanelRightOpen /> Open and edit
        </DropdownMenuItem>
        {choices.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <CircleDot /> Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              <StageItems item={item} ctx={ctx} choices={choices} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <AssignItems item={item} people={ctx.people} ctx={ctx} />
        <DropdownMenuItem onSelect={() => ctx.logTime(item.id)}>
          <Clock /> Log time
        </DropdownMenuItem>
        {topLevel && (
          <DropdownMenuItem onSelect={() => ctx.create({ stage: "TODO", parentId: item.id })}>
            <ListPlus /> Add work under this
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void ctx.archive(item.id)}>
          <Archive /> Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AssignItems({ item, people, ctx }: { item: WorkItem; people: BoardPerson[]; ctx: RowCtx }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <UserRound /> Assign
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
        {people.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() =>
              p.id !== item.assigneeId &&
              void ctx.patch(item.id, { assigneeId: p.id }, {
                assigneeId: p.id,
                assignee: { id: p.id, name: p.name, image: null },
              })
            }
          >
            <PersonAvatar person={p} size={18} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {p.id === item.assigneeId ? (
              <Check className="size-4 text-primary" />
            ) : (
              <span className="text-[10px] text-muted-foreground">{p.role === "CLIENT" ? "Client" : "Team"}</span>
            )}
          </DropdownMenuItem>
        ))}
        {item.assigneeId && (
          <DropdownMenuItem
            className="text-muted-foreground"
            onSelect={() => void ctx.patch(item.id, { assigneeId: null }, { assigneeId: null, assignee: null })}
          >
            <X /> Unassign
          </DropdownMenuItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
