"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
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
  positionBetween,
  type BoardCard,
  type BoardColumn,
  type BoardData,
  type BoardSide,
} from "@/lib/board";
import { createBoardTask, moveBoardTask } from "@/lib/actions/project-board";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CardFace, SortableCard, type CardContext } from "./board-card";
import { PersonAvatar, todayKey } from "./board-bits";
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

const TaskDrawer = dynamic(() => import("./task-drawer").then((m) => m.TaskDrawer), {
  ssr: false,
});
const NewTaskDialog = dynamic(() => import("./new-task-dialog").then((m) => m.NewTaskDialog), {
  ssr: false,
});

export type BoardViewer = { id: string; side: BoardSide; name: string };

type Timed = { startedAt: number; data: BoardData } | null;

async function timedFetch(url: string): Promise<Timed> {
  const startedAt = Date.now();
  const res = await fetch(url);
  if (!res.ok) return null;
  return { startedAt, data: (await res.json()) as BoardData };
}

function sameCard(a: BoardCard, b: BoardCard) {
  return (
    a.updatedAt === b.updatedAt &&
    a.position === b.position &&
    a.status === b.status &&
    a.commentCount === b.commentCount &&
    a.helpFrom === b.helpFrom &&
    a.title === b.title
  );
}

/**
 * Fold fresh server cards into the current list, keeping every unchanged card
 * the same object. The cards are memoised on identity, so a poll that changed
 * nothing re-renders nothing, and one that changed a card re-renders that card.
 */
function reconcile(prev: BoardCard[], next: BoardCard[]): BoardCard[] {
  const byId = new Map(prev.map((c) => [c.id, c]));
  let changed = prev.length !== next.length;
  const merged = next.map((n) => {
    const p = byId.get(n.id);
    if (p && sameCard(p, n)) return p;
    changed = true;
    return n;
  });
  return changed ? merged : prev;
}

const COLLAPSE_KEY = "avix.board.collapsed";

function readCollapsed(): ProjectTaskStatus[] {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? (JSON.parse(raw) as ProjectTaskStatus[]) : [];
  } catch {
    return [];
  }
}

/**
 * The shared project board: five columns both the client and the team work
 * in. Cards drag between and within columns; every move is applied locally
 * first and confirmed by a one-row write, so the board never waits on the
 * network. A light poll keeps both sides in step.
 */
export function ProjectBoard({
  projectId,
  viewer,
  initial,
  renderedAt,
  initialTaskId = null,
}: {
  projectId: string;
  viewer: BoardViewer;
  initial: BoardData;
  /** When the server built `initial` — a page from the router cache may be old. */
  renderedAt: number;
  /** ?task= from the URL — a notification's deep link to one card. */
  initialTaskId?: string | null;
}) {
  const [cards, setCards] = useState(initial.cards);
  const [meta, setMeta] = useState({ people: initial.people, milestones: initial.milestones });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialTaskId);
  const [creating, setCreating] = useState<{ status: ProjectTaskStatus } | null>(null);
  const [query, setQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [milestoneFilter, setMilestoneFilter] = useState<string | null>(null);
  const [helpOnly, setHelpOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<ProjectTaskStatus[]>([]);
  const [today] = useState(todayKey);
  // A notification link to another card on this same page arrives as a new
  // ?task= without remounting the board; open it.
  const [seenTaskParam, setSeenTaskParam] = useState(initialTaskId);
  if (initialTaskId !== seenTaskParam) {
    setSeenTaskParam(initialTaskId);
    if (initialTaskId) setOpenId(initialTaskId);
  }

  // Refs the poll consults so it never clobbers a drag or an unsaved move.
  const dragging = useRef(false);
  const pending = useRef(0);
  const lastLocal = useRef(0);
  const snapshot = useRef<BoardCard[]>([]);
  const cardsRef = useRef(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    // Per-viewer convenience, read after mount so the server render matches.
    const stored = readCollapsed();
    if (stored.length) queueMicrotask(() => setCollapsed(stored));
  }, []);

  const { mutate } = useSWR<Timed>(`/api/projects/${projectId}/board`, timedFetch, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
    // The server just rendered this board; asking again on mount would double
    // the work of every page load. The effect below catches the one case
    // where it's worth it — a page handed back from the router cache.
    revalidateOnMount: false,
    dedupingInterval: 3_000,
    onSuccess: (res) => {
      if (!res || dragging.current || pending.current > 0 || res.startedAt < lastLocal.current) return;
      setCards((prev) => reconcile(prev, res.data.cards));
      setMeta((prev) =>
        prev.people.length === res.data.people.length &&
        prev.milestones.length === res.data.milestones.length &&
        prev.milestones.every((m, i) => m.title === res.data.milestones[i]?.title)
          ? prev
          : { people: res.data.people, milestones: res.data.milestones },
      );
    },
  });

  useEffect(() => {
    if (Date.now() - renderedAt > 5_000) void mutate();
  }, [mutate, renderedAt]);

  const peopleById = useMemo(() => new Map(meta.people.map((p) => [p.id, p])), [meta.people]);
  const milestonesById = useMemo(
    () => new Map(meta.milestones.map((m) => [m.id, m])),
    [meta.milestones],
  );
  const ctx: CardContext = useMemo(
    () => ({ peopleById, milestonesById, viewer: { id: viewer.id, side: viewer.side }, today }),
    [peopleById, milestonesById, viewer.id, viewer.side, today],
  );

  const filtering = !!query.trim() || !!assigneeFilter || !!milestoneFilter || helpOnly;
  const columns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const by: Record<ProjectTaskStatus, BoardCard[]> = {
      BACKLOG: [],
      TODO: [],
      IN_PROGRESS: [],
      REVIEW: [],
      DONE: [],
    };
    for (const c of cards) {
      if (needle && !c.title.toLowerCase().includes(needle)) continue;
      if (assigneeFilter && c.assigneeId !== assigneeFilter) continue;
      if (milestoneFilter && c.milestoneId !== milestoneFilter) continue;
      if (helpOnly && !c.helpFrom) continue;
      by[c.status].push(c);
    }
    for (const list of Object.values(by)) list.sort((a, b) => a.position - b.position);
    return by;
  }, [cards, query, assigneeFilter, milestoneFilter, helpOnly]);

  /* ---------------------------------------------------------------- */
  /* Mutations                                                         */
  /* ---------------------------------------------------------------- */

  const track = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    pending.current++;
    lastLocal.current = Date.now();
    try {
      return await work();
    } finally {
      pending.current--;
      lastLocal.current = Date.now();
    }
  }, []);

  const upsert = useCallback((card: BoardCard, replaceId?: string) => {
    setCards((prev) => {
      const id = replaceId ?? card.id;
      const exists = prev.some((c) => c.id === id);
      return exists ? prev.map((c) => (c.id === id ? card : c)) : [...prev, card];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // A task made from a chat message lands here at once, not on the next poll.
  useEffect(() => {
    function onCard(e: Event) {
      const detail = (e as CustomEvent<{ projectId: string; card: BoardCard }>).detail;
      if (detail?.projectId === projectId) upsert(detail.card);
    }
    window.addEventListener("avix:board-card", onCard);
    return () => window.removeEventListener("avix:board-card", onCard);
  }, [projectId, upsert]);

  const quickAdd = useCallback(
    async (status: ProjectTaskStatus, title: string, atTop: boolean) => {
      const list = cardsRef.current
        .filter((c) => c.status === status)
        .sort((a, b) => a.position - b.position);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = new Date().toISOString();
      const temp: BoardCard = {
        id: tempId,
        title,
        status,
        position: atTop
          ? positionBetween(null, list[0]?.position)
          : positionBetween(list[list.length - 1]?.position, null),
        priority: null,
        dueDate: null,
        milestoneId: null,
        assigneeId: null,
        createdById: viewer.id,
        createdByRole: viewer.side,
        hasDescription: false,
        commentCount: 0,
        helpFrom: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      upsert(temp);
      const result = await track(() => createBoardTask({ projectId, title, status, atTop }));
      if (!result.ok) {
        remove(tempId);
        toast.error(result.error);
        return;
      }
      upsert(result.data.card, tempId);
    },
    [projectId, viewer.id, viewer.side, viewer.name, track, upsert, remove],
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

  function statusOf(id: string): ProjectTaskStatus | null {
    if (id.startsWith("col:")) return id.slice(4) as ProjectTaskStatus;
    return cardsRef.current.find((c) => c.id === id)?.status ?? null;
  }

  function onDragStart(e: DragStartEvent) {
    dragging.current = true;
    snapshot.current = cardsRef.current;
    setActiveId(String(e.active.id));
  }

  // Crossing into another column moves the card there immediately, so the gap
  // opens where it will land rather than where it came from.
  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeKey = String(active.id);
    const overKey = String(over.id);
    const from = statusOf(activeKey);
    const to = statusOf(overKey);
    if (!from || !to || from === to) return;

    const target = columns[to].filter((c) => c.id !== activeKey);
    let index = target.length;
    if (!overKey.startsWith("col:")) {
      const overIndex = target.findIndex((c) => c.id === overKey);
      const translated = active.rect.current.translated;
      const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
      index = overIndex < 0 ? target.length : overIndex + (below ? 1 : 0);
    }
    const position = positionBetween(target[index - 1]?.position, target[index]?.position);
    setCards((prev) => prev.map((c) => (c.id === activeKey ? { ...c, status: to, position } : c)));
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const id = String(active.id);
    setActiveId(null);
    const before = snapshot.current.find((c) => c.id === id);
    if (!over || !before) {
      dragging.current = false;
      setCards(snapshot.current);
      return;
    }

    const current = cardsRef.current.find((c) => c.id === id)!;
    const status = current.status;
    const list = columns[status];
    const oldIndex = list.findIndex((c) => c.id === id);
    const overKey = String(over.id);
    let newIndex = oldIndex;
    if (!overKey.startsWith("col:") && statusOf(overKey) === status) {
      newIndex = list.findIndex((c) => c.id === overKey);
    }
    const ordered = oldIndex >= 0 && newIndex >= 0 ? arrayMove(list, oldIndex, newIndex) : list;
    const at = ordered.findIndex((c) => c.id === id);
    const position =
      at < 0 ? current.position : positionBetween(ordered[at - 1]?.position, ordered[at + 1]?.position);

    dragging.current = false;
    if (status === before.status && (oldIndex === newIndex || at < 0) && current.position === before.position) {
      return;
    }

    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, status, position } : c)));
    const result = await track(() => moveBoardTask({ taskId: id, status, position }));
    if (!result.ok) {
      setCards(snapshot.current);
      toast.error(result.error);
      return;
    }
    const { card, renumbered } = result.data;
    if (renumbered.length) {
      const map = new Map(renumbered.map((r) => [r.id, r.position]));
      setCards((prev) =>
        prev.map((c) => (c.id === card.id ? card : map.has(c.id) ? { ...c, position: map.get(c.id)! } : c)),
      );
    } else {
      upsert(card);
    }
  }

  function onDragCancel() {
    dragging.current = false;
    setActiveId(null);
    setCards(snapshot.current);
  }

  /* ---------------------------------------------------------------- */
  /* Opening cards                                                     */
  /* ---------------------------------------------------------------- */

  // The open card lives in the URL too, so it can be shared and survives a
  // reload. replaceState: opening a card is not a navigation.
  const openTask = useCallback((id: string | null) => {
    setOpenId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("task", id);
    else url.searchParams.delete("task");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);

  function toggleCollapsed(status: ProjectTaskStatus) {
    setCollapsed((prev) => {
      const next = prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status];
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* private mode — collapsing just won't persist */
      }
      return next;
    });
  }

  const activeCard = activeId ? cards.find((c) => c.id === activeId) ?? null : null;
  const openCard = openId ? cards.find((c) => c.id === openId) ?? null : null;
  const total = cards.length;
  const doneCount = cards.filter((c) => c.status === "DONE").length;
  const helpCount = cards.filter((c) => c.helpFrom && c.helpFrom !== viewer.side).length;
  const assignees = meta.people.filter((p) => cards.some((c) => c.assigneeId === p.id));

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
              placeholder="Search tasks"
              aria-label="Search tasks"
              className="h-9 w-full rounded-lg border bg-background pr-8 pl-8 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
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
                  title={`Only ${p.name}'s tasks`}
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

          {meta.milestones.length > 0 && (
            <label className="relative inline-flex h-9 items-center rounded-lg border bg-background pl-2.5 text-sm">
              <MilestoneIcon className="size-3.5 text-muted-foreground" />
              <select
                value={milestoneFilter ?? ""}
                onChange={(e) => setMilestoneFilter(e.target.value || null)}
                aria-label="Filter by milestone"
                className="h-full max-w-[11rem] cursor-pointer appearance-none truncate bg-transparent pr-3 pl-1.5 outline-none"
              >
                <option value="">All milestones</option>
                {meta.milestones.map((m) => (
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
                setMilestoneFilter(null);
                setHelpOnly(false);
              }}
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <StatusBattery cards={cards} side={viewer.side} />
          <span className="hidden text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:inline">
            {doneCount}/{total} done
          </span>
          <Button onClick={() => setCreating({ status: "TODO" })} className="shrink-0">
            <Plus /> New task
          </Button>
        </div>
      </div>

      {total === 0 ? (
        <EmptyBoard side={viewer.side} onCreate={() => setCreating({ status: "TODO" })} />
      ) : (
        <DndContext
          id={`board-${projectId}`}
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
            {BOARD_COLUMNS.map((column) => (
              <Column
                key={column.id}
                column={column}
                side={viewer.side}
                cards={columns[column.id]}
                ctx={ctx}
                collapsed={collapsed.includes(column.id)}
                onToggle={() => toggleCollapsed(column.id)}
                onOpen={openTask}
                onQuickAdd={quickAdd}
                isTarget={!!activeCard && activeCard.status === column.id}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }}>
            {activeCard ? <CardFace card={activeCard} ctx={ctx} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {openId && (
        <TaskDrawer
          taskId={openId}
          card={openCard}
          viewer={viewer}
          people={meta.people}
          milestones={meta.milestones}
          today={today}
          onClose={() => openTask(null)}
          onCardChange={upsert}
          onCardDelete={(id) => {
            remove(id);
            openTask(null);
          }}
          onMove={async (id, status) => {
            const list = cardsRef.current.filter((c) => c.status === status && c.id !== id);
            const position = positionBetween(
              list.reduce<number | null>((max, c) => (max == null || c.position > max ? c.position : max), null),
              null,
            );
            const prev = cardsRef.current;
            setCards((cur) => cur.map((c) => (c.id === id ? { ...c, status, position } : c)));
            const result = await track(() => moveBoardTask({ taskId: id, status, position }));
            if (!result.ok) {
              setCards(prev);
              toast.error(result.error);
              return;
            }
            upsert(result.data.card);
          }}
          track={track}
        />
      )}

      {creating && (
        <NewTaskDialog
          open
          onOpenChange={(o) => !o && setCreating(null)}
          projectId={projectId}
          viewer={viewer}
          people={meta.people}
          milestones={meta.milestones}
          defaultStatus={creating.status}
          onCreated={(card) => {
            upsert(card);
            setCreating(null);
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- */

function Column({
  column,
  side,
  cards,
  ctx,
  collapsed,
  onToggle,
  onOpen,
  onQuickAdd,
  isTarget,
}: {
  column: BoardColumn;
  side: BoardSide;
  cards: BoardCard[];
  ctx: CardContext;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
  onQuickAdd: (status: ProjectTaskStatus, title: string, atTop: boolean) => Promise<void>;
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
        <span className="text-xs font-semibold tracking-wide text-muted-foreground [writing-mode:vertical-rl]">
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
          <button
            type="button"
            onClick={() => setAdding("top")}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            aria-label={`Add a task to ${label}`}
            title="Add a task"
          >
            <Plus className="size-4" />
          </button>
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
              {column.id === "REVIEW" && side === "CLIENT"
                ? "Nothing waiting on you"
                : "Drop a task here"}
            </div>
          )}
        </div>
      </SortableContext>

      {adding === "bottom" ? (
        <QuickAdd
          onSubmit={(title) => onQuickAdd(column.id, title, false)}
          onClose={() => setAdding(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding("bottom")}
          className="mx-2 mb-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <Plus className="size-3.5" /> Add task
        </button>
      )}
    </section>
  );
}

/**
 * Inline add, ClickUp-style: type, Enter, type the next one. Stays open until
 * Escape or a click away, so ten tasks don't take ten dialogs.
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
        placeholder="Task name — Enter to add"
        className="w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-muted-foreground sm:text-[13px] max-sm:text-base"
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
function StatusBattery({ cards, side }: { cards: BoardCard[]; side: BoardSide }) {
  const total = cards.length;
  if (total === 0) return null;
  return (
    <div
      className="flex h-2 w-28 overflow-hidden rounded-full bg-muted sm:w-36"
      role="img"
      aria-label={BOARD_COLUMNS.map((c) => {
        const n = cards.filter((card) => card.status === c.id).length;
        return `${n} ${side === "CLIENT" ? c.clientLabel : c.label}`;
      }).join(", ")}
    >
      {BOARD_COLUMNS.map((c) => {
        const n = cards.filter((card) => card.status === c.id).length;
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

function EmptyBoard({ side, onCreate }: { side: BoardSide; onCreate: () => void }) {
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
      <h3 className="title-card">
        {side === "CLIENT" ? "Your project board is ready" : "No tasks on this board yet"}
      </h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
        {side === "CLIENT"
          ? "Add requests, feedback and to-dos here. Pin someone from the team on a task and we'll pick it up — you'll see it move from To do to Done."
          : "Tasks you and the client add land here. Drag them across as work moves; anything in Review asks the client to take a look."}
      </p>
      <Button onClick={onCreate} className="mt-5">
        <Plus /> Add the first task
      </Button>
    </div>
  );
}
