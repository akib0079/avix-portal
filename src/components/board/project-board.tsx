"use client";

import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { ProjectTaskStatus } from "@prisma/client";
import { toast } from "sonner";
import {
  BOARD_COLUMNS,
  COLUMN_BY_ID,
  canMoveWorkItem,
  positionBetween,
  type BoardColumn,
  type BoardSide,
  type WorkItem,
} from "@/lib/board";
import { createWorkItem } from "@/lib/actions/project-board";
import { stageToStatus } from "@/lib/work-stage";
import { useLocalSet } from "@/lib/use-local-pref";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CardFace, SortableCard, type CardContext } from "./board-card";
import { PersonAvatar } from "./board-bits";
import { useWork, type BoardViewer } from "./work-store";
import {
  Plus,
  Search,
  LifeBuoy,
  ChevronsLeftRight,
  ChevronsRightLeft,
  X,
  KanbanSquare,
  Milestone as MilestoneIcon,
} from "lucide-react";

export type { BoardViewer } from "./work-store";

/**
 * The project's work as stage columns, the view both the client and the team
 * work in — the same items as the Milestones list, from the same store. Cards
 * drag between and within columns as far as canMoveWorkItem allows: the team
 * anywhere but into or out of Requested (a request is accepted or declined,
 * from its card), a client only approving or sending back what's in review.
 * Every move is painted first and confirmed by a one-row write, so the board
 * never waits on the network.
 */
export function ProjectBoard({ switcher }: { switcher?: ReactNode }) {
  const work = useWork();
  const { viewer, items: cards, people, phases, today } = work;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState<string | null>(null);
  const [helpOnly, setHelpOnly] = useState(false);
  const [collapsed, toggleCollapsed] = useLocalSet("avix.board.collapsed");
  const snapshot = useRef<WorkItem[]>([]);

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const phasesById = useMemo(() => new Map(phases.map((m) => [m.id, m])), [phases]);
  const ctx: CardContext = useMemo(
    () => ({
      peopleById,
      phasesById,
      viewer: { id: viewer.id, side: viewer.side, role: viewer.role },
      today,
      // Prices on cards are the admin's alone: a client reads theirs in the
      // list, as on the timeline before.
      showPrice: viewer.role === "ADMIN" && work.pricesShown,
      onAccept: work.accept,
      onDecline: work.decline,
    }),
    [peopleById, phasesById, viewer.id, viewer.side, viewer.role, today, work.pricesShown, work.accept, work.decline],
  );

  const filtering = !!query.trim() || !!assigneeFilter || !!phaseFilter || helpOnly;
  const columns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const by: Record<ProjectTaskStatus, WorkItem[]> = {
      REQUESTED: [],
      BACKLOG: [],
      TODO: [],
      IN_PROGRESS: [],
      REVIEW: [],
      DONE: [],
    };
    for (const c of cards) {
      if (needle && !c.title.toLowerCase().includes(needle)) continue;
      if (assigneeFilter && c.assigneeId !== assigneeFilter) continue;
      // A phase filter shows the phase and the work under it.
      if (phaseFilter && c.parentId !== phaseFilter && c.id !== phaseFilter) continue;
      if (helpOnly && !c.helpFrom) continue;
      by[c.stage].push(c);
    }
    for (const list of Object.values(by)) list.sort((a, b) => a.boardPosition - b.boardPosition);
    return by;
  }, [cards, query, assigneeFilter, phaseFilter, helpOnly]);

  /* ---------------------------------------------------------------- */
  /* Quick add                                                         */
  /* ---------------------------------------------------------------- */

  const quickAdd = useCallback(
    async (stage: ProjectTaskStatus, title: string, atTop: boolean) => {
      const list = work.itemsRef.current
        .filter((c) => c.stage === stage)
        .sort((a, b) => a.boardPosition - b.boardPosition);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const temp = draftItem(tempId, title, stage, viewer, {
        position: Math.max(-1, ...work.itemsRef.current.map((c) => c.position)) + 1,
        boardPosition: atTop
          ? positionBetween(null, list[0]?.boardPosition)
          : positionBetween(list[list.length - 1]?.boardPosition, null),
      });
      work.upsert(temp);
      const result = await work.track(() =>
        createWorkItem({ projectId: work.projectId, title, stage, atTop }),
      );
      if (!result.ok) {
        work.drop([tempId]);
        toast.error(result.error);
        return;
      }
      work.upsert(result.data.item, tempId);
    },
    [work, viewer],
  );

  /* ---------------------------------------------------------------- */
  /* Drag and drop                                                     */
  /* ---------------------------------------------------------------- */

  // Distance for the mouse, a long-press for touch (so a swipe still scrolls
  // the board sideways), Space for the keyboard — Enter is kept for "open".
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  function stageOf(id: string): ProjectTaskStatus | null {
    if (id.startsWith("col:")) return id.slice(4) as ProjectTaskStatus;
    return work.itemsRef.current.find((c) => c.id === id)?.stage ?? null;
  }

  function onDragStart(e: DragStartEvent) {
    snapshot.current = work.beginDrag();
    setActiveId(String(e.active.id));
  }

  // Crossing into another column moves the card there immediately, so the gap
  // opens where it will land rather than where it came from.
  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeKey = String(active.id);
    const overKey = String(over.id);
    const from = stageOf(activeKey);
    const to = stageOf(overKey);
    if (!from || !to || from === to) return;
    // Only open the columns this card may actually go to.
    const origin = snapshot.current.find((c) => c.id === activeKey);
    if (origin && origin.stage !== to && !canMoveWorkItem(viewer, origin, origin.stage, to).ok) return;

    const target = columns[to].filter((c) => c.id !== activeKey);
    let index = target.length;
    if (!overKey.startsWith("col:")) {
      const overIndex = target.findIndex((c) => c.id === overKey);
      const translated = active.rect.current.translated;
      const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
      index = overIndex < 0 ? target.length : overIndex + (below ? 1 : 0);
    }
    const boardPosition = positionBetween(target[index - 1]?.boardPosition, target[index]?.boardPosition);
    work.setItems((prev) =>
      prev.map((c) => (c.id === activeKey ? { ...c, stage: to, status: stageToStatus(to), boardPosition } : c)),
    );
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const id = String(active.id);
    setActiveId(null);
    const before = snapshot.current.find((c) => c.id === id);
    work.endDrag();
    if (!over || !before) {
      work.setItems(snapshot.current);
      return;
    }

    const current = work.itemsRef.current.find((c) => c.id === id)!;
    const stage = current.stage;
    const list = columns[stage];
    const oldIndex = list.findIndex((c) => c.id === id);
    const overKey = String(over.id);
    let newIndex = oldIndex;
    if (!overKey.startsWith("col:") && stageOf(overKey) === stage) {
      newIndex = list.findIndex((c) => c.id === overKey);
    }
    const ordered = oldIndex >= 0 && newIndex >= 0 ? arrayMove(list, oldIndex, newIndex) : list;
    const at = ordered.findIndex((c) => c.id === id);
    const boardPosition =
      at < 0
        ? current.boardPosition
        : positionBetween(ordered[at - 1]?.boardPosition, ordered[at + 1]?.boardPosition);

    if (
      stage === before.stage &&
      (oldIndex === newIndex || at < 0) &&
      current.boardPosition === before.boardPosition
    ) {
      return;
    }
    // A drop the server would refuse goes back quietly when it stayed in its
    // own column (a client can't reorder), and says why when it crossed one.
    if (!canMoveWorkItem(viewer, before, before.stage, stage).ok && stage === before.stage) {
      work.setItems(snapshot.current);
      return;
    }
    await work.move(id, stage, { boardPosition, revert: snapshot.current });
  }

  function onDragCancel() {
    work.endDrag();
    setActiveId(null);
    work.setItems(snapshot.current);
  }

  const activeCard = activeId ? cards.find((c) => c.id === activeId) ?? null : null;
  const total = cards.length;
  const doneCount = cards.filter((c) => c.stage === "DONE").length;
  const helpCount = cards.filter((c) => c.helpFrom && c.helpFrom !== viewer.side).length;
  const assignees = people.filter((p) => cards.some((c) => c.assigneeId === p.id));
  const team = viewer.side === "ADMIN";

  // Requested leads the board. The team sees it only while something waits in
  // it; a client always does — it's where their own asks live.
  const shown = BOARD_COLUMNS.filter(
    (column) => column.id !== "REQUESTED" || !team || columns.REQUESTED.length > 0,
  );

  return (
    <div className="min-w-0">
      {/* Toolbar: what's here, what's moving, and the filters. */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search milestones"
              aria-label="Search milestones"
              className="h-9 w-full rounded-lg border bg-background pr-8 pl-8 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 max-sm:text-base"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {assignees.length > 0 && (
            <div className="flex items-center gap-1 rounded-lg border bg-background px-1.5 py-1" role="group" aria-label="Filter by person">
              {assignees.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setAssigneeFilter((cur) => (cur === p.id ? null : p.id))}
                  aria-pressed={assigneeFilter === p.id}
                  title={`Only ${p.name}'s work`}
                  className={cn(
                    "rounded-full transition-[opacity,box-shadow]",
                    assigneeFilter && assigneeFilter !== p.id && "opacity-35 hover:opacity-80",
                    assigneeFilter === p.id && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                  )}
                >
                  <PersonAvatar person={p} size={24} />
                </button>
              ))}
            </div>
          )}

          {phases.length > 0 && (
            <label className="relative inline-flex h-9 items-center rounded-lg border bg-background pl-2.5 text-sm">
              <MilestoneIcon className="size-3.5 text-muted-foreground" />
              <select
                value={phaseFilter ?? ""}
                onChange={(e) => setPhaseFilter(e.target.value || null)}
                aria-label="Filter by phase"
                className="h-full max-w-[11rem] cursor-pointer appearance-none truncate bg-transparent pr-3 pl-1.5 outline-none"
              >
                <option value="">All phases</option>
                {phases.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            onClick={() => setHelpOnly((v) => !v)}
            aria-pressed={helpOnly}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors",
              helpOnly
                ? "border-red-400/60 bg-red-500/10 text-red-600 dark:text-red-400"
                : "bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            <LifeBuoy className="size-3.5" />
            Help
            {helpCount > 0 && (
              <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white tabular-nums">
                {helpCount}
              </span>
            )}
          </button>

          {filtering && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setAssigneeFilter(null);
                setPhaseFilter(null);
                setHelpOnly(false);
              }}
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <StatusBattery cards={cards} side={viewer.side} />
          <span className="hidden text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:inline">
            {doneCount}/{total} done
          </span>
          <div className="ml-auto flex items-center gap-2">
            {switcher}
            {team && (
              <Button onClick={() => work.create({ stage: "TODO" })} className="shrink-0">
                <Plus /> Add milestone
              </Button>
            )}
          </div>
        </div>
      </div>

      {total === 0 && team ? (
        <EmptyBoard onCreate={() => work.create({ stage: "TODO" })} />
      ) : (
        <DndContext
          id={`board-${work.projectId}`}
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          {/* Columns share the width on a wide screen and scroll sideways,
              one snap per column, on a narrow one. */}
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:snap-none sm:px-0 lg:gap-2.5 [scrollbar-width:thin]">
            {shown.map((column) => (
              <Column
                key={column.id}
                column={column}
                side={viewer.side}
                cards={columns[column.id]}
                ctx={ctx}
                collapsed={collapsed.has(column.id)}
                onToggle={() => toggleCollapsed(column.id)}
                onOpen={work.open}
                onQuickAdd={quickAdd}
                // The team adds anywhere but Requested; a client's asks go
                // through the one "Request a task" button.
                canAdd={team && column.id !== "REQUESTED"}
                isTarget={!!activeCard && activeCard.stage === column.id}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }}>
            {activeCard ? <CardFace card={activeCard} ctx={ctx} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

/** A card the board shows before the server has written it. */
function draftItem(
  id: string,
  title: string,
  stage: ProjectTaskStatus,
  viewer: BoardViewer,
  at: { position: number; boardPosition: number },
): WorkItem {
  const now = new Date().toISOString();
  return {
    id,
    title,
    stage,
    status: stageToStatus(stage),
    position: at.position,
    boardPosition: at.boardPosition,
    priority: null,
    dueDate: null,
    parentId: null,
    childCount: 0,
    assigneeId: null,
    assignee: null,
    createdById: viewer.id,
    createdByRole: viewer.side,
    creatorName: viewer.name,
    hasDescription: false,
    commentCount: 0,
    openHelp: { client: 0, team: 0 },
    helpFrom: null,
    loggedHours: 0,
    estimatedHours: null,
    pricingType: "NONE",
    hourlyRate: null,
    fixedPrice: null,
    billedOn: [],
    completedAt: null,
    clientApprovedAt: null,
    clientRating: null,
    clientRatingNote: null,
    sourceTaskRequestId: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/* -------------------------------------------------------------------- */

/** What an empty column says, from where the viewer stands. */
function emptyLabel(column: ProjectTaskStatus, side: BoardSide): string {
  if (column === "REQUESTED") {
    return side === "CLIENT"
      ? "Nothing waiting on the team. Use “Request a task” to ask for something new."
      : "No requests waiting";
  }
  if (column === "REVIEW" && side === "CLIENT") return "Nothing waiting on you";
  return side === "CLIENT" ? "Nothing here yet" : "Drop a milestone here";
}

function Column({
  column,
  side,
  cards,
  ctx,
  collapsed,
  onToggle,
  onOpen,
  onQuickAdd,
  canAdd,
  isTarget,
}: {
  column: BoardColumn;
  side: BoardSide;
  cards: WorkItem[];
  ctx: CardContext;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
  onQuickAdd: (stage: ProjectTaskStatus, title: string, atTop: boolean) => Promise<void>;
  canAdd: boolean;
  isTarget: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` });
  const [adding, setAdding] = useState<"top" | "bottom" | null>(null);
  const label = side === "CLIENT" ? column.clientLabel : column.label;
  const style = { "--col": column.color } as CSSProperties;

  if (collapsed) {
    // ClickUp-style folded column: a slim spine you can still drop onto.
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "flex w-11 shrink-0 snap-start flex-col items-center gap-3 rounded-2xl border bg-muted/40 py-3 transition-colors",
          isOver && "bg-[color-mix(in_oklab,var(--col)_14%,transparent)]",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
          aria-label={`Expand ${label}`}
          title={`Expand ${label}`}
        >
          <ChevronsLeftRight className="size-4" />
        </button>
        <span className="size-2 rounded-full bg-[var(--col)]" />
        <span className="text-xs font-semibold tabular-nums">{cards.length}</span>
        <span className="text-xs font-semibold tracking-wide whitespace-nowrap text-muted-foreground [writing-mode:vertical-rl]">
          {label}
        </span>
      </div>
    );
  }

  return (
    <section
      style={style}
      aria-label={label}
      className={cn(
        "flex w-[84vw] max-w-[320px] min-w-[240px] shrink-0 snap-center flex-col rounded-2xl border bg-[color-mix(in_oklab,var(--col)_4%,var(--muted))] transition-[background-color,box-shadow] sm:w-auto sm:flex-1 sm:basis-0 lg:min-w-[196px]",
        (isOver || isTarget) && "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--col)_55%,transparent)]",
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white shadow-sm"
          style={{ background: column.color }}
        >
          {label}
        </span>
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">{cards.length}</span>
        <div className="ml-auto flex items-center">
          {canAdd && (
            <button
              type="button"
              onClick={() => setAdding("top")}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              aria-label={`Add a milestone to ${label}`}
              title="Add a milestone"
            >
              <Plus className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            aria-label={`Collapse ${label}`}
            title="Collapse"
          >
            <ChevronsRightLeft className="size-4" />
          </button>
        </div>
      </header>
      {column.id === "REQUESTED" && side === "ADMIN" && cards.length > 0 && (
        <p className="-mt-1 px-3 pb-2 text-[11px] leading-snug text-muted-foreground">
          The client&apos;s asks — accept or decline each one.
        </p>
      )}

      {adding === "top" && (
        <QuickAdd
          onSubmit={(title) => onQuickAdd(column.id, title, true)}
          onClose={() => setAdding(null)}
        />
      )}

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 sm:max-h-[min(70vh,52rem)] [scrollbar-width:thin]"
        >
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} ctx={ctx} onOpen={onOpen} />
          ))}
          {cards.length === 0 && adding !== "top" && (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-[color-mix(in_oklab,var(--col)_35%,var(--border))] px-3 py-6 text-center text-xs text-muted-foreground">
              {emptyLabel(column.id, side)}
            </div>
          )}
        </div>
      </SortableContext>

      {adding === "bottom" ? (
        <QuickAdd
          onSubmit={(title) => onQuickAdd(column.id, title, false)}
          onClose={() => setAdding(null)}
        />
      ) : !canAdd ? null : (
        <button
          type="button"
          onClick={() => setAdding("bottom")}
          className="mx-2 mb-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <Plus className="size-3.5" /> Add
        </button>
      )}
    </section>
  );
}

/**
 * Inline add, ClickUp-style: type, Enter, type the next one. Stays open until
 * Escape or a click away, so ten milestones don't take ten dialogs.
 */
function QuickAdd({
  onSubmit,
  onClose,
}: {
  onSubmit: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const title = value.trim();
    if (!title) return;
    setValue("");
    void onSubmit(title.slice(0, 200));
  }

  return (
    <div className="mx-2 mb-2 rounded-xl border bg-card p-2 shadow-sm">
      <textarea
        autoFocus
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            onClose();
          }
        }}
        onBlur={() => {
          if (!value.trim()) onClose();
        }}
        placeholder="Name it — Enter to add"
        className="w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-muted-foreground max-sm:text-base"
        maxLength={200}
      />
      <div className="mt-1 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <Button size="sm" onMouseDown={(e) => e.preventDefault()} onClick={submit} disabled={!value.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

/**
 * monday's "battery": one bar, split by column, so the shape of the work reads
 * in a glance — mostly green means nearly there.
 */
function StatusBattery({ cards, side }: { cards: WorkItem[]; side: BoardSide }) {
  const total = cards.length;
  if (total === 0) return null;
  return (
    <div
      className="flex h-2 w-28 overflow-hidden rounded-full bg-muted sm:w-36"
      role="img"
      aria-label={BOARD_COLUMNS.map((c) => {
        const n = cards.filter((card) => card.stage === c.id).length;
        return `${n} ${side === "CLIENT" ? c.clientLabel : c.label}`;
      }).join(", ")}
    >
      {BOARD_COLUMNS.map((c) => {
        const n = cards.filter((card) => card.stage === c.id).length;
        if (!n) return null;
        return (
          <span
            key={c.id}
            className="h-full transition-[width] duration-500"
            style={{ width: `${(n / total) * 100}%`, background: c.color }}
            title={`${COLUMN_BY_ID[c.id].label}: ${n}`}
          />
        );
      })}
    </div>
  );
}

function EmptyBoard({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed bg-card px-6 py-14 text-center">
      <div className="mx-auto mb-5 flex w-fit gap-1.5" aria-hidden>
        {BOARD_COLUMNS.map((c, i) => (
          <span
            key={c.id}
            className="rise flex h-14 w-8 flex-col gap-1 rounded-lg p-1"
            style={{ "--i": i, background: `color-mix(in oklab, ${c.color} 14%, transparent)` } as CSSProperties}
          >
            <span className="h-2 rounded-sm" style={{ background: c.color }} />
            {i % 2 === 0 && <span className="h-2 rounded-sm bg-card" />}
          </span>
        ))}
      </div>
      <KanbanSquare className="sr-only" />
      <h3 className="title-card">No milestones on this project yet</h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
        Work you add, and the client&apos;s requests, land here. Drag cards across as work moves;
        anything in review asks the client to take a look.
      </p>
      <Button onClick={onCreate} className="mt-5">
        <Plus /> Add the first milestone
      </Button>
    </div>
  );
}
