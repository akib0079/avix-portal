"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import type { ProjectBillingType, ProjectTaskStatus } from "@prisma/client";
import { toast } from "sonner";
import {
  COLUMN_BY_ID,
  canMoveWorkItem,
  canSeePricing,
  type BoardData,
  type BoardPerson,
  type BoardPhase,
  type BoardSide,
  type WorkItem,
  type WorkRole,
} from "@/lib/board";
import {
  archiveWorkItem,
  deleteWorkItem,
  moveWorkItem,
  restoreWorkItem,
  updateWorkItem,
  withdrawWorkItem,
} from "@/lib/actions/project-board";
import { stageToStatus } from "@/lib/work-stage";
import { endOfColumn, planPhases } from "@/lib/work-list";
import { todayKey } from "./board-bits";
import {
  AcceptRequestDialog,
  DeclineRequestDialog,
  SendBackDialog,
  type AcceptChoice,
} from "./work-dialogs";

const TaskDrawer = dynamic(() => import("./task-drawer").then((m) => m.TaskDrawer), { ssr: false });
const NewTaskDialog = dynamic(() => import("./new-task-dialog").then((m) => m.NewTaskDialog), {
  ssr: false,
});
const TimeLogDialog = dynamic(
  () => import("@/components/milestones/time-log-dialog").then((m) => m.TimeLogDialog),
  { ssr: false },
);

/**
 * One project's work, held once for everything on the page that draws it:
 * the Milestones list, the board, the item drawer, and the live figures in
 * the header. Before this the board kept its own copy and the list rendered
 * the server's, so a drag on the board left the list (and the header) stale
 * until the next page load.
 *
 * The items start from the server render and stay current through one light
 * poll (the version token answers 204 when nothing changed). Every write is
 * painted here first and confirmed by an action that hands back the row it
 * wrote, so neither view waits on the network; the poll never overwrites a
 * write in flight. The decisions that need a dialog — sending work back,
 * accepting or declining a request, logging time, adding an item — live
 * here too, so the list and the board ask for them the same way.
 */

/** Who is looking. STAFF is on the team's side but money-blind. */
export type BoardViewer = { id: string; side: BoardSide; role: WorkRole; name: string };

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
    a.position === b.position &&
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
 * the same object. Rows and cards are memoised on identity, so a poll that
 * changed nothing re-renders nothing, and one that changed a card re-renders
 * that card.
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

function samePeople(a: BoardPerson[], b: BoardPerson[]) {
  return a.length === b.length && a.every((p, i) => p.id === b[i]?.id && p.name === b[i]?.name);
}

type SendingBack = { id: string; stage: ProjectTaskStatus; boardPosition: number; revert: WorkItem[] };

export type WorkStore = {
  projectId: string;
  viewer: BoardViewer;
  billingType: ProjectBillingType;
  /**
   * Per-item prices are shown to this viewer on this project: an admin or the
   * client (see canSeePricing), and never on a fixed-contract project, where
   * the price is the project's. Staff never.
   */
  pricesShown: boolean;
  items: WorkItem[];
  people: BoardPerson[];
  /** What work can go under, from the items held — current the moment one is added. */
  phases: BoardPhase[];
  /** "YYYY-MM-DD" in the viewer's own calendar. */
  today: string;

  /* The board's drag needs the raw state and the guards around it. */
  setItems: Dispatch<SetStateAction<WorkItem[]>>;
  itemsRef: RefObject<WorkItem[]>;
  /** Marks a drag in progress, so the poll leaves the board alone. Returns the board as it was. */
  beginDrag: () => WorkItem[];
  endDrag: () => void;
  /** Runs a write with the poll held off until it lands. */
  track: <T>(work: () => Promise<T>) => Promise<T>;
  upsert: (item: WorkItem, replaceId?: string) => void;
  /** Takes items off the live set (after an archive, a decline, a withdrawal). */
  drop: (ids: string[]) => void;
  /** Ask the server for the current board now. */
  refresh: () => void;

  /* Intents both views share. */
  openId: string | null;
  open: (id: string | null) => void;
  /**
   * Move an item to a stage — from a menu (end of the column) or a drop
   * (`boardPosition`, with `revert` the board before the drag). Asks for the
   * reason first when a client sends work back.
   */
  move: (
    id: string,
    stage: ProjectTaskStatus,
    at?: { boardPosition: number; revert: WorkItem[] },
  ) => Promise<boolean>;
  patch: (
    id: string,
    change: Parameters<typeof updateWorkItem>[1],
    optimistic: Partial<WorkItem>,
  ) => Promise<boolean>;
  accept: (id: string) => void;
  decline: (id: string) => void;
  sendBack: (id: string) => void;
  logTime: (id: string) => void;
  create: (defaults?: { stage?: ProjectTaskStatus; parentId?: string | null }) => void;
  archive: (id: string) => Promise<boolean>;
  /** Restores an archived item; resolves to the live item, or null on failure. */
  restore: (id: string) => Promise<WorkItem | null>;
  /** ADMIN: delete an item with no history (anything with history is archived instead). */
  remove: (id: string) => Promise<boolean>;
  /** A client takes back their own request. */
  withdraw: (id: string) => Promise<boolean>;
};

const WorkContext = createContext<WorkStore | null>(null);

/** The project's work store. Only inside a WorkProvider. */
export function useWork(): WorkStore {
  const store = useContext(WorkContext);
  if (!store) throw new Error("useWork() outside a WorkProvider");
  return store;
}

/** The store when there is one — for pieces that also render without it (the header). */
export function useWorkOptional(): WorkStore | null {
  return useContext(WorkContext);
}

export function WorkProvider({
  projectId,
  viewer,
  billingType,
  initial,
  renderedAt,
  initialItemId = null,
  children,
}: {
  projectId: string;
  viewer: BoardViewer;
  billingType: ProjectBillingType;
  initial: BoardData;
  /** When the server built `initial` — a page from the router cache may be old. */
  renderedAt: number;
  /** ?item= (or a v48 ?task=) from the URL — a notification's deep link to one item. */
  initialItemId?: string | null;
  children: ReactNode;
}) {
  const [items, setItems] = useState(initial.items);
  const [people, setPeople] = useState(initial.people);
  const phases = useMemo(() => planPhases(items), [items]);
  const [openId, setOpenId] = useState<string | null>(initialItemId);
  const [today] = useState(todayKey);
  const [sendingBack, setSendingBack] = useState<SendingBack | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [logging, setLogging] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ stage?: ProjectTaskStatus; parentId?: string | null } | null>(
    null,
  );
  // A notification link to another item on this same page arrives as a new
  // ?item= without remounting; open it. Adjusted during render.
  const [seenItemParam, setSeenItemParam] = useState(initialItemId);
  if (initialItemId !== seenItemParam) {
    setSeenItemParam(initialItemId);
    if (initialItemId) setOpenId(initialItemId);
  }

  // Refs the poll consults so it never clobbers a drag or an unsaved write.
  const dragging = useRef(false);
  const pending = useRef(0);
  const lastLocal = useRef(0);
  const itemsRef = useRef(items);
  const versionRef = useRef(initial.version);
  const seenInitial = useRef(initial);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // The poll sends the version it holds; an unchanged board answers 204 with
  // no body, so a quiet board costs the server one small query. A hidden tab
  // keeps polling, slowly, so coming back to it isn't stale for long.
  const { mutate } = useSWR<Timed>(
    `/api/projects/${projectId}/board`,
    (url: string) => timedFetch(url, versionRef.current),
    {
      refreshInterval: () => (typeof document !== "undefined" && document.hidden ? 60_000 : 15_000),
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
        setItems((prev) => reconcile(prev, data.items));
        setPeople((prev) => (samePeople(prev, data.people) ? prev : data.people));
      },
    },
  );

  useEffect(() => {
    if (Date.now() - renderedAt > 5_000) void mutate();
  }, [mutate, renderedAt]);

  // A fresh server render — an action that revalidated this page, a refresh —
  // hands over newer rows: take them, unless a write or a drag is in flight,
  // in which case the poll catches up instead. A render the router kept from
  // a while ago is older than what's here: ask the server rather than step
  // back to it.
  useEffect(() => {
    if (initial === seenInitial.current) return;
    seenInitial.current = initial;
    if (dragging.current || pending.current > 0) return;
    if (Date.now() - renderedAt > 5_000) {
      void mutate();
      return;
    }
    versionRef.current = initial.version;
    queueMicrotask(() => {
      setItems((prev) => reconcile(prev, initial.items));
      setPeople((prev) => (samePeople(prev, initial.people) ? prev : initial.people));
    });
  }, [initial, renderedAt, mutate]);

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

  const refresh = useCallback(() => void mutate(), [mutate]);

  const upsert = useCallback((item: WorkItem, replaceId?: string) => {
    setItems((prev) => {
      const id = replaceId ?? item.id;
      return prev.some((c) => c.id === id) ? prev.map((c) => (c.id === id ? item : c)) : [...prev, item];
    });
  }, []);

  const drop = useCallback((ids: string[]) => {
    const gone = new Set(ids);
    setItems((prev) => prev.filter((c) => !gone.has(c.id)));
  }, []);

  const beginDrag = useCallback(() => {
    dragging.current = true;
    return itemsRef.current;
  }, []);
  const endDrag = useCallback(() => {
    dragging.current = false;
  }, []);

  // An item made from a chat message lands here at once, not on the next poll.
  useEffect(() => {
    function onItem(e: Event) {
      const detail = (e as CustomEvent<{ projectId: string; item: WorkItem }>).detail;
      if (detail?.projectId === projectId && detail.item) upsert(detail.item);
    }
    window.addEventListener("avix:board-card", onItem);
    return () => window.removeEventListener("avix:board-card", onItem);
  }, [projectId, upsert]);

  // Read by the writes below, so they stay the same functions while the
  // drawer opens and closes (the rows are memoised on them).
  const openIdRef = useRef(openId);
  useEffect(() => {
    openIdRef.current = openId;
  }, [openId]);

  // The open item lives in the URL too, so it can be shared and survives a
  // reload. replaceState: opening an item is not a navigation.
  const open = useCallback((id: string | null) => {
    setOpenId(id);
    const url = new URL(window.location.href);
    url.searchParams.delete("task");
    if (id) url.searchParams.set("item", id);
    else url.searchParams.delete("item");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);

  /** Writes a move already painted locally; `revert` restores the items on failure. */
  const commitMove = useCallback(
    async (
      id: string,
      stage: ProjectTaskStatus,
      boardPosition: number,
      revert: WorkItem[],
      comment?: string,
    ): Promise<boolean> => {
      const result = await track(() => moveWorkItem({ itemId: id, stage, boardPosition, comment }));
      if (!result.ok) {
        setItems(revert);
        toast.error(result.error);
        return false;
      }
      const { item, renumbered } = result.data;
      const moved = new Map(renumbered.map((r) => [r.id, r.boardPosition]));
      setItems((prev) =>
        prev.map((c) =>
          c.id === item.id ? item : moved.has(c.id) ? { ...c, boardPosition: moved.get(c.id)! } : c,
        ),
      );
      if (viewer.side === "CLIENT" && item.stage === "DONE") toast.success("Approved — thank you!");
      return true;
    },
    [track, viewer.side],
  );

  const move = useCallback(
    async (id: string, stage: ProjectTaskStatus, at?: { boardPosition: number; revert: WorkItem[] }) => {
      const item = itemsRef.current.find((c) => c.id === id);
      if (!item) return false;
      const from = at ? (at.revert.find((c) => c.id === id)?.stage ?? item.stage) : item.stage;
      const check = canMoveWorkItem(viewer, item, from, stage);
      if (!check.ok) {
        if (at) setItems(at.revert);
        toast.error(check.error);
        return false;
      }
      const revert = at?.revert ?? itemsRef.current;
      const boardPosition = at?.boardPosition ?? endOfColumn(itemsRef.current, stage, id);
      // Paint first; status follows stage so the list's counts move too.
      setItems((prev) =>
        prev.map((c) => (c.id === id ? { ...c, stage, status: stageToStatus(stage), boardPosition } : c)),
      );
      if (check.kind === "send-back") {
        // The team needs to know why: ask before writing anything.
        setSendingBack({ id, stage, boardPosition, revert });
        return true;
      }
      return commitMove(id, stage, boardPosition, revert);
    },
    [viewer, commitMove],
  );

  const patch = useCallback(
    async (id: string, change: Parameters<typeof updateWorkItem>[1], optimistic: Partial<WorkItem>) => {
      const before = itemsRef.current.find((c) => c.id === id);
      if (before) upsert({ ...before, ...optimistic });
      const result = await track(() => updateWorkItem(id, change));
      if (!result.ok) {
        if (before) upsert(before);
        toast.error(result.error);
        return false;
      }
      upsert(result.data.item);
      return true;
    },
    [track, upsert],
  );

  // Structural writes revalidate the page, and the server's render is the
  // truth for whatever moved with them (a phase's work, renumbered plans):
  // once they land, ask for the current board.
  const archive = useCallback(
    async (id: string) => {
      const before = itemsRef.current;
      // A phase takes its accepted work along; a request under it stays live.
      setItems((prev) =>
        prev
          .filter((c) => c.id !== id && !(c.parentId === id && c.stage !== "REQUESTED"))
          .map((c) => (c.parentId === id ? { ...c, parentId: null } : c)),
      );
      if (openIdRef.current === id) open(null);
      const result = await track(() => archiveWorkItem(id));
      if (!result.ok) {
        setItems(before);
        toast.error(result.error);
        return false;
      }
      toast.success("Archived — it's under “Show archived” with its history.");
      refresh();
      return true;
    },
    [track, refresh, open],
  );

  const restore = useCallback(
    async (id: string) => {
      const result = await track(() => restoreWorkItem(id));
      if (!result.ok) {
        toast.error(result.error);
        return null;
      }
      upsert(result.data.item);
      toast.success("Restored.");
      refresh();
      return result.data.item;
    },
    [track, upsert, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const before = itemsRef.current;
      drop([id]);
      if (openIdRef.current === id) open(null);
      const result = await track(() => deleteWorkItem(id));
      if (!result.ok) {
        setItems(before);
        toast.error(result.error);
        return false;
      }
      toast.success(result.data.archived ? "Archived — its history is kept." : "Deleted.");
      refresh();
      return true;
    },
    [track, drop, refresh, open],
  );

  const withdraw = useCallback(
    async (id: string) => {
      const before = itemsRef.current;
      drop([id]);
      if (openIdRef.current === id) open(null);
      const result = await track(() => withdrawWorkItem(id));
      if (!result.ok) {
        setItems(before);
        toast.error(result.error);
        return false;
      }
      toast.success("Request withdrawn.");
      return true;
    },
    [track, drop, open],
  );

  const sendBack = useCallback(
    (id: string) => {
      void move(id, "IN_PROGRESS");
    },
    [move],
  );

  const create = useCallback(
    (defaults?: { stage?: ProjectTaskStatus; parentId?: string | null }) => setCreating(defaults ?? {}),
    [],
  );

  /** Paints an accepted request where the team put it, until the poll brings the row. */
  const accepted = useCallback(
    (id: string, choice: AcceptChoice) => {
      const item = itemsRef.current.find((c) => c.id === id);
      if (!item) return;
      const person = choice.assigneeId ? people.find((p) => p.id === choice.assigneeId) : null;
      const priced = viewer.role === "ADMIN";
      upsert({
        ...item,
        stage: choice.stage,
        status: stageToStatus(choice.stage),
        boardPosition: endOfColumn(itemsRef.current, choice.stage, id),
        assigneeId: choice.assigneeId,
        assignee: person ? { id: person.id, name: person.name, image: null } : null,
        dueDate: choice.dueDate,
        parentId: choice.parentId,
        ...(priced
          ? {
              pricingType: choice.pricingType,
              hourlyRate: choice.pricingType === "HOURLY" ? (choice.hourlyRate ?? null) : null,
              estimatedHours: choice.pricingType === "HOURLY" ? (choice.estimatedHours ?? null) : null,
              fixedPrice: choice.pricingType === "FIXED" ? (choice.fixedPrice ?? null) : null,
            }
          : {}),
      });
      refresh();
    },
    [people, viewer.role, upsert, refresh],
  );

  const value = useMemo<WorkStore>(
    () => ({
      projectId,
      viewer,
      billingType,
      pricesShown: canSeePricing(viewer.role, billingType) && billingType !== "CONTRACT",
      items,
      people,
      phases,
      today,
      setItems,
      itemsRef,
      beginDrag,
      endDrag,
      track,
      upsert,
      drop,
      refresh,
      openId,
      open,
      move,
      patch,
      accept: setAccepting,
      decline: setDeclining,
      sendBack,
      logTime: setLogging,
      create,
      archive,
      restore,
      remove,
      withdraw,
    }),
    [
      projectId,
      viewer,
      billingType,
      items,
      people,
      phases,
      today,
      beginDrag,
      endDrag,
      track,
      upsert,
      drop,
      refresh,
      openId,
      open,
      move,
      patch,
      sendBack,
      create,
      archive,
      restore,
      remove,
      withdraw,
    ],
  );

  const find = (id: string | null) => (id ? (items.find((c) => c.id === id) ?? null) : null);
  const acceptingItem = find(accepting);
  const decliningItem = find(declining);
  const loggingItem = find(logging);
  const sendingItem = sendingBack ? find(sendingBack.id) : null;
  const clientName = people.find((p) => p.role === "CLIENT")?.name ?? null;

  return (
    <WorkContext.Provider value={value}>
      {children}

      {openId && <TaskDrawer key={openId} itemId={openId} onClose={() => open(null)} />}

      {creating && (
        <NewTaskDialog
          open
          onOpenChange={(o) => !o && setCreating(null)}
          projectId={projectId}
          viewer={viewer}
          billingType={billingType}
          people={people}
          phases={phases}
          defaultStage={creating.stage}
          defaultParentId={creating.parentId ?? null}
          onCreated={(item) => {
            upsert(item);
            setCreating(null);
          }}
        />
      )}

      {loggingItem && (
        <TimeLogDialog
          milestone={loggingItem}
          open
          onOpenChange={(o) => !o && setLogging(null)}
          onChanged={refresh}
        />
      )}

      <SendBackDialog
        open={!!sendingBack}
        title={sendingItem?.title ?? ""}
        to={sendingBack?.stage ?? "IN_PROGRESS"}
        onCancel={() => {
          if (sendingBack) setItems(sendingBack.revert);
          setSendingBack(null);
        }}
        onSend={async (comment) => {
          if (!sendingBack) return false;
          const { id, stage, boardPosition, revert } = sendingBack;
          const ok = await commitMove(id, stage, boardPosition, revert, comment);
          if (ok) {
            setSendingBack(null);
            toast.success(`Sent back to ${COLUMN_BY_ID[stage].clientLabel} — the team has your note.`);
          }
          return ok;
        }}
      />

      {acceptingItem?.sourceTaskRequestId && (
        <AcceptRequestDialog
          open
          onOpenChange={(o) => !o && setAccepting(null)}
          requestId={acceptingItem.sourceTaskRequestId}
          title={acceptingItem.title}
          clientName={clientName}
          projectId={projectId}
          role={viewer.role}
          billingType={billingType}
          people={people}
          phases={phases}
          itemId={acceptingItem.id}
          defaultPricing={{
            pricingType: acceptingItem.pricingType,
            hourlyRate: acceptingItem.hourlyRate,
            estimatedHours: acceptingItem.estimatedHours,
            fixedPrice: acceptingItem.fixedPrice,
          }}
          onAccepted={(choice) => accepted(acceptingItem.id, choice)}
        />
      )}

      {decliningItem?.sourceTaskRequestId && (
        <DeclineRequestDialog
          open
          onOpenChange={(o) => !o && setDeclining(null)}
          requestId={decliningItem.sourceTaskRequestId}
          title={decliningItem.title}
          clientName={clientName}
          onDeclined={() => {
            drop([decliningItem.id]);
            if (openId === decliningItem.id) open(null);
            refresh();
          }}
        />
      )}
    </WorkContext.Provider>
  );
}
