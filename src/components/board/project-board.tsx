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
  canMoveWorkItem,
  positionBetween,
  type BoardColumn,
  type BoardData,
  type BoardSide,
  type WorkItem,
  type WorkRole,
} from "@/lib/board";
import { createWorkItem, moveWorkItem } from "@/lib/actions/project-board";
import { stageToStatus } from "@/lib/work-stage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Loader2,
  Milestone as MilestoneIcon,
} from "lucide-react";

const TaskDrawer = dynamic(() => import("./task-drawer").then((m) => m.TaskDrawer), {
  ssr: false,
});
const NewTaskDialog = dynamic(() => import("./new-task-dialog").then((m) => m.NewTaskDialog), {
  ssr: false,
});

export type BoardViewer = { id: string; side: BoardSide; name: string };

/** For the move rules: on the board, admin and staff move alike. */
function roleOf(viewer: { side: BoardSide }): WorkRole {
  return viewer.side === "CLIENT" ? "CLIENT" : "ADMIN";
}

/** null data = the server said nothing changed (204). */
type Timed = { startedAt: number; data: BoardData | null } | null;

async function timedFetch(url: string, version: string): Promise<Timed> {
  const startedAt = Date.now();
  const res = await fetch(`${url}?v=${encodeURIComponent(version)}`);
  if (res.status === 204) return { startedAt, data: null };
  if (!res.ok) return null;
  return { startedAt, data: (await res.json()) as BoardData };
}

function sameItem(a: WorkItem, b: WorkItem) {
  return (
    a.updatedAt === b.updatedAt &&
    a.boardPosition === b.boardPosition &&
    a.stage === b.stage &&
    a.commentCount === b.commentCount &&
    a.helpFrom === b.helpFrom &&
    a.openHelp.client === b.openHelp.client &&
    a.openHelp.team === b.openHelp.team &&
    a.loggedHours === b.loggedHours &&
    a.childCount === b.childCount &&
    a.billedOn.length === b.billedOn.length &&
    a.title === b.title
  );
}

/**
 * Fold fresh server items into the current list, keeping every unchanged item
 * the same object. The cards are memoised on identity, so a poll that changed
 * nothing re-renders nothing, and one that changed a card re-renders that card.
 */
function reconcile(prev: WorkItem[], next: WorkItem[]): WorkItem[] {
  const byId = new Map(prev.map((c) => [c.id, c]));
  let changed = prev.length !== next.length;
  const merged = next.map((n) => {
    const p = byId.get(n.id);
    if (p && sameItem(p, n)) return p;
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
 * The shared project board: the stage columns both the client and the team
 * work in, over the same work items as the Milestones list. Cards drag between
 * and within columns — as far as canMoveWorkItem allows: the team anywhere but
 * into or out of Requested, a client only approving or sending back what's in
 * review. Every move is applied locally first and confirmed by a one-row
 * write, so the board never waits on the network. A light poll keeps both
 * sides in step.
 */
export function ProjectBoard({
  projectId,
  viewer,
  initial,
  renderedAt,
  initialItemId = null,
}: {
  projectId: string;
  viewer: BoardViewer;
  initial: BoardData;
  /** When the server built `initial` — a page from the router cache may be old. */
  renderedAt: number;
  /** ?item= (or a v48 ?task=) from the URL — a notification's deep link to one card. */
  initialItemId?: string | null;
}) {
  const role = roleOf(viewer);
  const [cards, setCards] = useState(initial.items);
  const [meta, setMeta] = useState({ people: initial.people, phases: initial.phases });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialItemId);
  const [creating, setCreating] = useState<{ stage: ProjectTaskStatus } | null>(null);
  const [sendingBack, setSendingBack] = useState<{
    id: string;
    stage: ProjectTaskStatus;
    boardPosition: number;
    revert: WorkItem[];
  } | null>(null);
  const [query, setQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState<string | null>(null);
  const [helpOnly, setHelpOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<ProjectTaskStatus[]>([]);
  const [today] = useState(todayKey);
  // A notification link to another card on this same page arrives as a new
  // ?item= without remounting the board; open it.
  const [seenItemParam, setSeenItemParam] = useState(initialItemId);
  if (initialItemId !== seenItemParam) {
    setSeenItemParam(initialItemId);
    if (initialItemId) setOpenId(initialItemId);
  }

  // Refs the poll consults so it never clobbers a drag or an unsaved move.
  const dragging = useRef(false);
  const pending = useRef(0);
  const lastLocal = useRef(0);
  const snapshot = useRef<WorkItem[]>([]);
  const cardsRef = useRef(cards);
  const versionRef = useRef(initial.version);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    // Per-viewer convenience, read after mount so the server render matches.
    const stored = readCollapsed();
    if (stored.length) queueMicrotask(() => setCollapsed(stored));
  }, []);

  // The poll sends the version it holds; an unchanged board answers 204 with
  // no body, so a quiet board costs the server one small query. A hidden tab
  // keeps polling, slowly, so coming back to it isn't stale for long.
  const { mutate } = useSWR<Timed>(
    `/api/projects/${projectId}/board`,
    (url: string) => timedFetch(url, versionRef.current),
    {
      refreshInterval: () =>
        typeof document !== "undefined" && document.hidden ? 60_000 : 15_000,
      refreshWhenHidden: true,
      revalidateOnFocus: true,
      // The server just rendered this board; asking again on mount would double
      // the work of every page load. The effect below catches the one case
      // where it's worth it — a page handed back from the router cache.
      revalidateOnMount: false,
      dedupingInterval: 3_000,
      onSuccess: (res) => {
        const data = res?.data;
        if (!res || !data) return;
        if (dragging.current || pending.current > 0 || res.startedAt < lastLocal.current) return;
        versionRef.current = data.version;
        setCards((prev) => reconcile(prev, data.items));
        setMeta((prev) =>
          prev.people.length === data.people.length &&
          prev.phases.length === data.phases.length &&
          prev.phases.every((m, i) => m.id === data.phases[i]?.id && m.title === data.phases[i]?.title)
            ? prev
            : { people: data.people, phases: data.phases },
        );
      },
    },
  );

  useEffect(() => {
    if (Date.now() - renderedAt > 5_000) void mutate();
  }, [mutate, renderedAt]);

  const peopleById = useMemo(() => new Map(meta.people.map((p) => [p.id, p])), [meta.people]);
  const phasesById = useMemo(() => new Map(meta.phases.map((m) => [m.id, m])), [meta.phases]);
  const ctx: CardContext = useMemo(
    () => ({ peopleById, phasesById, viewer: { id: viewer.id, side: viewer.side }, today }),
    [peopleById, phasesById, viewer.id, viewer.side, today],
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

  const upsert = useCallback((card: WorkItem, replaceId?: string) => {
    setCards((prev) => {
      const id = replaceId ?? card.id;
      const exists = prev.some((c) => c.id === id);
      return exists ? prev.map((c) => (c.id === id ? card : c)) : [...prev, card];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // An item made from a chat message lands here at once, not on the next poll.
  useEffect(() => {
    function onCard(e: Event) {
      const detail = (e as CustomEvent<{ projectId: string; item: WorkItem }>).detail;
      if (detail?.projectId === projectId) upsert(detail.item);
    }
    window.addEventListener("avix:board-card", onCard);
    return () => window.removeEventListener("avix:board-card", onCard);
  }, [projectId, upsert]);

  const quickAdd = useCallback(
    async (stage: ProjectTaskStatus, title: string, atTop: boolean) => {
      // A client's addition always waits in Requested (the server decides).
      const column: ProjectTaskStatus = viewer.side === "CLIENT" ? "REQUESTED" : stage;
      const list = cardsRef.current
        .filter((c) => c.stage === column)
        .sort((a, b) => a.boardPosition - b.boardPosition);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const temp = draftItem(tempId, title, column, viewer, {
        position: Math.max(-1, ...cardsRef.current.map((c) => c.position)) + 1,
        boardPosition: atTop
          ? positionBetween(null, list[0]?.boardPosition)
          : positionBetween(list[list.length - 1]?.boardPosition, null),
      });
      upsert(temp);
      const result = await track(() => createWorkItem({ projectId, title, stage: column, atTop }));
      if (!result.ok) {
        remove(tempId);
        toast.error(result.error);
        return;
      }
      upsert(result.data.item, tempId);
    },
    [projectId, viewer, track, upsert, remove],
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
    return cardsRef.current.find((c) => c.id === id)?.stage ?? null;
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
    const from = stageOf(activeKey);
    const to = stageOf(overKey);
    if (!from || !to || from === to) return;
    // Only open the columns this card may actually go to.
    const origin = snapshot.current.find((c) => c.id === activeKey);
    if (origin && origin.stage !== to && !canMoveWorkItem({ role }, origin, origin.stage, to).ok) return;

    const target = columns[to].filter((c) => c.id !== activeKey);
    let index = target.length;
    if (!overKey.startsWith("col:")) {
      const overIndex = target.findIndex((c) => c.id === overKey);
      const translated = active.rect.current.translated;
      const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
      index = overIndex < 0 ? target.length : overIndex + (below ? 1 : 0);
    }
    const boardPosition = positionBetween(
      target[index - 1]?.boardPosition,
      target[index]?.boardPosition,
    );
    setCards((prev) =>
      prev.map((c) => (c.id === activeKey ? { ...c, stage: to, boardPosition } : c)),
    );
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

    dragging.current = false;
    if (
      stage === before.stage &&
      (oldIndex === newIndex || at < 0) &&
      current.boardPosition === before.boardPosition
    ) {
      return;
    }
    const check = canMoveWorkItem({ role }, before, before.stage, stage);
    if (!check.ok) {
      setCards(snapshot.current);
      if (stage !== before.stage) toast.error(check.error);
      return;
    }

    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, stage, boardPosition } : c)));
    if (check.kind === "send-back") {
      // The team needs to know why: ask before writing anything.
      setSendingBack({ id, stage, boardPosition, revert: snapshot.current });
      return;
    }
    await commitMove(id, stage, boardPosition, snapshot.current);
  }

  /** Writes a move already painted locally; `revert` restores the board on failure. */
  async function commitMove(
    id: string,
    stage: ProjectTaskStatus,
    boardPosition: number,
    revert: WorkItem[],
    comment?: string,
  ): Promise<boolean> {
    const result = await track(() => moveWorkItem({ itemId: id, stage, boardPosition, comment }));
    if (!result.ok) {
      setCards(revert);
      toast.error(result.error);
      return false;
    }
    const { item, renumbered } = result.data;
    if (renumbered.length) {
      const map = new Map(renumbered.map((r) => [r.id, r.boardPosition]));
      setCards((prev) =>
        prev.map((c) =>
          c.id === item.id ? item : map.has(c.id) ? { ...c, boardPosition: map.get(c.id)! } : c,
        ),
      );
    } else {
      upsert(item);
    }
    if (role === "CLIENT" && item.stage === "DONE") toast.success("Approved — thank you!");
    return true;
  }

  /** A stage picked from a menu: to the end of that column, asking for a reason if it's a send-back. */
  async function requestMove(id: string, stage: ProjectTaskStatus) {
    const card = cardsRef.current.find((c) => c.id === id);
    if (!card || card.stage === stage) return;
    const check = canMoveWorkItem({ role }, card, card.stage, stage);
    if (!check.ok) return void toast.error(check.error);
    const list = cardsRef.current.filter((c) => c.stage === stage && c.id !== id);
    const boardPosition = positionBetween(
      list.reduce<number | null>((max, c) => (max == null || c.boardPosition > max ? c.boardPosition : max), null),
      null,
    );
    const prev = cardsRef.current;
    setCards((cur) => cur.map((c) => (c.id === id ? { ...c, stage, boardPosition } : c)));
    if (check.kind === "send-back") {
      setSendingBack({ id, stage, boardPosition, revert: prev });
      return;
    }
    await commitMove(id, stage, boardPosition, prev);
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
    url.searchParams.delete("task");
    if (id) url.searchParams.set("item", id);
    else url.searchParams.delete("item");
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
  const doneCount = cards.filter((c) => c.stage === "DONE").length;
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

          {meta.phases.length > 0 && (
            <label className="relative inline-flex h-9 items-center rounded-lg border bg-background pl-2.5 text-sm">
              <MilestoneIcon className="size-3.5 text-muted-foreground" />
              <select
                value={phaseFilter ?? ""}
                onChange={(e) => setPhaseFilter(e.target.value || null)}
                aria-label="Filter by milestone"
                className="h-full max-w-[11rem] cursor-pointer appearance-none truncate bg-transparent pr-3 pl-1.5 outline-none"
              >
                <option value="">All milestones</option>
                {meta.phases.map((m) => (
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

        <div className="flex items-center gap-3">
          <StatusBattery cards={cards} side={viewer.side} />
          <span className="hidden text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:inline">
            {doneCount}/{total} done
          </span>
          <Button onClick={() => setCreating({ stage: "TODO" })} className="shrink-0">
            <Plus /> {viewer.side === "CLIENT" ? "New request" : "New task"}
          </Button>
        </div>
      </div>

      {total === 0 ? (
        <EmptyBoard side={viewer.side} onCreate={() => setCreating({ stage: "TODO" })} />
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
            {BOARD_COLUMNS.filter(
              // Requested only shows while something waits in it.
              (column) => column.id !== "REQUESTED" || columns.REQUESTED.length > 0,
            ).map((column) => (
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
                // A client's additions all land in Requested, so that is the
                // only column that offers them an "Add".
                canAdd={viewer.side === "ADMIN" ? column.id !== "REQUESTED" : column.id === "REQUESTED"}
                isTarget={!!activeCard && activeCard.stage === column.id}
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
          phases={meta.phases}
          today={today}
          onClose={() => openTask(null)}
          onCardChange={upsert}
          onCardDelete={(id) => {
            remove(id);
            openTask(null);
          }}
          onMove={requestMove}
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
          phases={meta.phases}
          defaultStage={creating.stage}
          onCreated={(card) => {
            upsert(card);
            setCreating(null);
          }}
        />
      )}

      <SendBackDialog
        open={!!sendingBack}
        title={sendingBack ? (cards.find((c) => c.id === sendingBack.id)?.title ?? "") : ""}
        to={sendingBack?.stage ?? "IN_PROGRESS"}
        onCancel={() => {
          if (sendingBack) setCards(sendingBack.revert);
          setSendingBack(null);
        }}
        onSend={async (comment) => {
          if (!sendingBack) return false;
          const { id, stage, boardPosition, revert } = sendingBack;
          const ok = await commitMove(id, stage, boardPosition, revert, comment);
          if (ok) {
            setSendingBack(null);
            toast.success("Sent back — the team has your note.");
          }
          return ok;
        }}
      />
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

/**
 * Sending work back needs a reason — the team can't fix what nobody named.
 * The note is posted on the item as a comment.
 */
function SendBackDialog({
  open,
  title,
  to,
  onCancel,
  onSend,
}: {
  open: boolean;
  title: string;
  to: ProjectTaskStatus;
  onCancel: () => void;
  onSend: (comment: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Send back to the team</DialogTitle>
          <DialogDescription>
            “{title}” goes back to {COLUMN_BY_ID[to].clientLabel}. What needs changing?
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={5000}
          placeholder="e.g. The header image is still the old one, and the button should say “Book now”."
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || !note.trim()}
            onClick={async () => {
              setBusy(true);
              const ok = await onSend(note.trim());
              setBusy(false);
              if (ok) setNote("");
            }}
          >
            {busy && <Loader2 className="animate-spin" />} Send back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
          {canAdd && (
            <button
              type="button"
              onClick={() => setAdding("top")}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              aria-label={`Add a task to ${label}`}
              title="Add a task"
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
      ) : !canAdd ? null : (
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
          ? "Ask for anything here. Your request waits in Requested until the team picks it up — then you'll see it move from To do to Done, and anything in Your review is waiting for your OK."
          : "Work you add, and the client's requests, land here. Drag cards across as work moves; anything in Review asks the client to take a look."}
      </p>
      <Button onClick={onCreate} className="mt-5">
        <Plus /> Add the first task
      </Button>
    </div>
  );
}
