import type {
  InvoiceStatus,
  MilestoneStatus,
  PricingType,
  Priority,
  ProjectBillingType,
  ProjectTaskStatus,
  TaskRequestStatus,
} from "@prisma/client";
import type { JSONContent } from "@tiptap/react";

/**
 * Shared vocabulary for project work — safe on both sides of the wire.
 *
 * Since v49 a piece of work is one Milestone row, shown both as a row in the
 * Milestones list and as a card on the board, so the two views can never
 * disagree. The reads live in src/lib/dal/project-board.ts, the writes in
 * src/lib/actions/project-board.tsx; the rules both sides need (who may move
 * what, where a dropped card goes, which links still resolve) live here, pure,
 * so the server enforces exactly what the UI offers and both are tested once.
 */

/** Which side of the relationship a person is on. Matches MessageSenderRole. */
export type BoardSide = "ADMIN" | "CLIENT";

/** The three kinds of viewer. STAFF is on the team's side but money-blind. */
export type WorkRole = "ADMIN" | "STAFF" | "CLIENT";

export function workRole(role: string | null | undefined): WorkRole | null {
  return role === "ADMIN" || role === "STAFF" || role === "CLIENT" ? role : null;
}

export function sideOfRole(role: WorkRole): BoardSide {
  return role === "CLIENT" ? "CLIENT" : "ADMIN";
}

export type BoardColumn = {
  id: ProjectTaskStatus;
  label: string;
  /** What the column means to a client, who reads "Review" as "my turn". */
  clientLabel: string;
  /** Column colour (any CSS colour). Tints and rings are mixed from it in CSS. */
  color: string;
};

/**
 * Six fixed columns. The colours borrow monday's habit of making status
 * readable from across the room. In progress is the brand colour itself, so a
 * custom branding colour set in Settings carries onto the board.
 */
export const BOARD_COLUMNS: BoardColumn[] = [
  { id: "REQUESTED", label: "Requested", clientLabel: "Requested", color: "#f59e0b" },
  { id: "BACKLOG", label: "Backlog", clientLabel: "Backlog", color: "#94a3b8" },
  { id: "TODO", label: "To do", clientLabel: "To do", color: "#3b82f6" },
  { id: "IN_PROGRESS", label: "In progress", clientLabel: "In progress", color: "var(--brand)" },
  { id: "REVIEW", label: "In review", clientLabel: "Your review", color: "#8b5cf6" },
  { id: "DONE", label: "Done", clientLabel: "Done", color: "#16a34a" },
];

export const COLUMN_BY_ID = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, c])) as Record<
  ProjectTaskStatus,
  BoardColumn
>;

export const PRIORITY_META: Record<Priority, { label: string; color: string; rank: number }> = {
  HIGH: { label: "High", color: "#e2445c", rank: 0 },
  MEDIUM: { label: "Medium", color: "#f59e0b", rank: 1 },
  LOW: { label: "Low", color: "#64748b", rank: 2 },
};

export type BoardPerson = {
  id: string;
  name: string;
  role: "ADMIN" | "STAFF" | "CLIENT";
};

/** A top-level item other work can be grouped under ("Design", "Launch"). */
export type BoardPhase = { id: string; title: string };
/** @deprecated The v48 name: a card's milestone is now its phase. */
export type BoardMilestone = BoardPhase;

export type WorkAssignee = { id: string; name: string; image: string | null };

/** An invoice this item is billed on. ADMIN payloads only. */
export type WorkBilling = { invoiceId: string; invoiceNumber: string; status: InvoiceStatus };

/**
 * One piece of work as both views draw it. No description and no thread:
 * those load with the drawer (WorkItemDetail), so the list and the poll stay
 * light.
 *
 * Money is stripped by viewer on the server (see the DAL): STAFF always get
 * pricingType NONE and nulls; a client sees their own prices, as the portal
 * timeline always has, but never billing; only ADMIN gets `billedOn`.
 */
export type WorkItem = {
  id: string;
  title: string;
  /** Board column — the truth. */
  stage: ProjectTaskStatus;
  /** The older three-state view, derived from stage (see work-stage.ts). */
  status: MilestoneStatus;
  /** Plan order in the list, renumbered 0..n. */
  position: number;
  /** Order inside the board column. Fractional, always above zero. */
  boardPosition: number;
  priority: Priority | null;
  /** "YYYY-MM-DD" — a calendar day, not an instant. */
  dueDate: string | null;
  /** The phase this sits under, if any. Phases are one level deep. */
  parentId: string | null;
  /** Live (non-archived) items under this one. */
  childCount: number;
  assigneeId: string | null;
  assignee: WorkAssignee | null;
  createdById: string | null;
  createdByRole: BoardSide;
  /** Null when the account that added it is gone; fall back on createdByRole. */
  creatorName: string | null;
  hasDescription: boolean;
  commentCount: number;
  /** Unanswered help requests, by the side that asked. */
  openHelp: { client: number; team: number };
  /** Who is waiting on an answer. When both asked, the client — we owe them first. */
  helpFrom: BoardSide | null;
  loggedHours: number;
  /** Null for STAFF (money-blind) and when there's no estimate. */
  estimatedHours: number | null;
  pricingType: PricingType;
  hourlyRate: number | null;
  fixedPrice: number | null;
  /** ADMIN only; always empty for everyone else. Cancelled invoices don't count. */
  billedOn: WorkBilling[];
  completedAt: string | null;
  clientApprovedAt: string | null;
  clientRating: number | null;
  clientRatingNote: string | null;
  /** The client request this came from. Every Requested item has one. */
  sourceTaskRequestId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** @deprecated The v48 name for a work item on the board. */
export type BoardCard = WorkItem;

/** Everything the Milestones tab draws, and what its poll returns. */
export type BoardData = {
  items: WorkItem[];
  people: BoardPerson[];
  phases: BoardPhase[];
  /** The poll's change token (see workVersion). */
  version: string;
};

export type BoardMention = { id: string; name: string };
export type BoardAttachment = { url: string; name: string };

export type BoardComment = {
  id: string;
  authorId: string | null;
  authorName: string;
  authorRole: BoardSide;
  authorIsStaff: boolean;
  kind: "COMMENT" | "HELP";
  body: string;
  mentions: BoardMention[];
  attachments: BoardAttachment[];
  resolvedAt: string | null;
  createdAt: string;
};

/** Hours logged on an item. Never carries rates or billing. */
export type WorkTimeEntry = {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  hours: number;
  note: string | null;
  /** Team payloads only — the client sees the work, not who clocked it. */
  userName: string | null;
};

/** An item opened in the drawer: the heavy parts the list leaves out. */
export type WorkItemDetail = {
  item: WorkItem;
  description: JSONContent | null;
  comments: BoardComment[];
  /** Newest first, capped. */
  timeEntries: WorkTimeEntry[];
  /** The client's request this came from — its status and our note on it. */
  request: { status: TaskRequestStatus; adminNote: string | null; resolvedAt: string | null } | null;
};

/** @deprecated The v48 name for a card opened in the drawer. */
export type BoardTaskDetail = WorkItemDetail;

/* ------------------------------------------------------------------------ */
/* Money visibility                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Whether a viewer may see an item's price. STAFF never (money-blind, fail
 * closed). A client sees their own prices, as the portal timeline always has
 * — except on a fixed-contract project, where per-item pricing is the team's
 * internal breakdown of one agreed price. Billing (which invoice it's on) is
 * ADMIN-only on top of this.
 */
export function canSeePricing(role: WorkRole, billingType: ProjectBillingType): boolean {
  if (role === "ADMIN") return true;
  if (role === "CLIENT") return billingType !== "CONTRACT";
  return false;
}

/* ------------------------------------------------------------------------ */
/* Positions                                                                 */
/* ------------------------------------------------------------------------ */

/** Gap left between cards so most drags never need a renumber. */
export const POSITION_STEP = 1024;

/** Closer than this, two neighbours have run out of room between them. */
export const MIN_POSITION_GAP = 1e-6;

/**
 * Where a card dropped between two neighbours goes. Midpoints halve the gap on
 * every drop at the same spot; when they wear it down to nothing the server
 * renumbers the column (see placeInColumn). The top edge is halfway to zero
 * rather than a step above the first card, so positions stay above zero — 0
 * marks a row nobody has placed yet (see work-backfill.ts).
 */
export function positionBetween(before?: number | null, after?: number | null): number {
  if (before == null && after == null) return POSITION_STEP;
  if (before == null) return after! / 2;
  if (after == null) return before + POSITION_STEP;
  return (before + after) / 2;
}

/**
 * The rows a drop writes. Normally one: the moved item, at the position the
 * board asked for. A position that lands on exactly one card — a neighbour a
 * filter hides, say — moves to the midpoint just past that card when there
 * is room, still one row.
 * When the position is unusable — not above zero, not a number, or within
 * MIN_POSITION_GAP of a neighbour after many drops at one spot — the column
 * is renumbered POSITION_STEP apart in the order the drop implies, and every
 * row that moved is returned.
 *
 * `others` is the destination column without the moved item.
 */
export function placeInColumn(
  others: readonly { id: string; boardPosition: number }[],
  id: string,
  requested: number,
): { id: string; boardPosition: number }[] {
  const rest = others.filter((o) => o.id !== id);
  const fits = (p: number) =>
    Number.isFinite(p) && p > 0 && rest.every((o) => Math.abs(o.boardPosition - p) >= MIN_POSITION_GAP);
  if (fits(requested)) return [{ id, boardPosition: requested }];

  const sorted = [...rest].sort((a, b) => a.boardPosition - b.boardPosition);
  const hits = sorted.filter((o) => Math.abs(o.boardPosition - requested) < MIN_POSITION_GAP);
  if (requested > 0 && hits.length === 1) {
    // The side of the card the renumber below would put the item on.
    const hit = hits[0].boardPosition;
    const nudged =
      requested > hit
        ? positionBetween(hit, sorted.find((o) => o.boardPosition > hit)?.boardPosition)
        : positionBetween(sorted.findLast((o) => o.boardPosition < hit)?.boardPosition, hit);
    if (fits(nudged)) return [{ id, boardPosition: nudged }];
  }

  const at = Number.isFinite(requested)
    ? sorted.filter((o) => o.boardPosition < requested).length
    : sorted.length;
  const order = [...sorted.slice(0, at).map((o) => o.id), id, ...sorted.slice(at).map((o) => o.id)];
  const before = new Map(rest.map((o) => [o.id, o.boardPosition]));
  return order
    .map((rowId, i) => ({ id: rowId, boardPosition: (i + 1) * POSITION_STEP }))
    .filter((row) => row.id === id || before.get(row.id) !== row.boardPosition);
}

/* ------------------------------------------------------------------------ */
/* Calendar days                                                             */
/* ------------------------------------------------------------------------ */

/**
 * A calendar day ("YYYY-MM-DD") as the Date Prisma stores: UTC midnight. One
 * rule for every day-valued column — due dates, time entries, the board — so
 * a date can't move a day when the server isn't on UTC. The old parsers used
 * server-local midnight, which read back a day early under BST.
 *
 * undefined = not given (leave the column alone); null or "" = clear it; an
 * impossible day such as 2026-02-31 also comes back null.
 */
export function parseDay(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || dayKey(date) !== value ? null : date;
}

/** The calendar day a stored day-valued Date names. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------------ */
/* Who may do what                                                           */
/* ------------------------------------------------------------------------ */

export type MoveKind = "reorder" | "move" | "approve" | "send-back";
export type MoveCheck = { ok: true; kind: MoveKind } | { ok: false; error: string };

/**
 * Who may move what where — the one rule behind every stage change: a drop on
 * the board, the drawer's stage picker, the list's stage menu. The server
 * enforces it; the UI asks it only to decide what to offer.
 *
 * The team moves anything anywhere, except into or out of Requested: those
 * are decisions (accept, with pricing, or decline, with a reason), made with
 * the request actions rather than a drag. A client gives a verdict on work the
 * team sent for review — approve it (to Done) or send it back (to To do or In
 * progress, with a comment saying why) — and moves nothing else, because the
 * stages carry money: Done is what makes fixed-price work billable.
 */
export function canMoveWorkItem(
  viewer: { role: WorkRole },
  item: { archivedAt?: string | Date | null },
  from: ProjectTaskStatus,
  to: ProjectTaskStatus,
): MoveCheck {
  if (item.archivedAt) return { ok: false, error: "This item is archived — restore it first." };

  if (viewer.role === "CLIENT") {
    if (from === "REVIEW" && to === "DONE") return { ok: true, kind: "approve" };
    if (from === "REVIEW" && (to === "TODO" || to === "IN_PROGRESS")) {
      return { ok: true, kind: "send-back" };
    }
    return {
      ok: false,
      error:
        from === "REVIEW"
          ? "Approve it, or send it back to the team with a note."
          : "The team moves this one — comment on it instead.",
    };
  }

  if (from === to) return { ok: true, kind: "reorder" };
  if (from === "REQUESTED") return { ok: false, error: "Accept or decline the request instead." };
  if (to === "REQUESTED") return { ok: false, error: "Only a client's request waits in Requested." };
  return { ok: true, kind: "move" };
}

/**
 * clientApprovedAt after a stage change. A client's move to Done is the
 * approval. Work the team sends (back) for review, or reopens, waits for a
 * fresh one — approving last week's version must not wave this week's
 * through. A team member closing work themselves leaves it as it was.
 */
export function approvalAfterMove(
  to: ProjectTaskStatus,
  by: WorkRole,
  current: Date | null,
  now: Date = new Date(),
): Date | null {
  if (to !== "DONE") return null;
  return by === "CLIENT" ? (current ?? now) : current;
}

/**
 * Why `parent` can't be this item's phase, or null when it can. Phases are one
 * level deep: phases hold work, work holds no phases. So the parent must be a
 * live, accepted, top-level item of the same project, and the item itself
 * must have no children (it would become a phase inside a phase).
 */
export function parentProblem(
  item: { id?: string | null; childCount: number },
  parent: {
    id: string;
    projectId: string;
    parentId: string | null;
    stage: ProjectTaskStatus;
    archivedAt: Date | string | null;
  } | null,
  projectId: string,
): string | null {
  if (!parent || parent.projectId !== projectId) return "That phase isn't on this project.";
  if (item.id && parent.id === item.id) return "An item can't sit under itself.";
  if (parent.parentId) return "Phases are one level deep — pick a top-level item.";
  if (parent.archivedAt) return "That phase is archived.";
  if (parent.stage === "REQUESTED") return "Accept that request before putting work under it.";
  if (item.childCount > 0) return "This item has its own sub-items, so it can't go under another.";
  return null;
}

/* ------------------------------------------------------------------------ */
/* Links                                                                     */
/* ------------------------------------------------------------------------ */

export type WorkView = "board" | "list";

/** The project tab that holds the list and the board. */
export const WORK_TAB = "milestones";

function isWorkView(value: string | null): value is WorkView {
  return value === "board" || value === "list";
}

/**
 * A deep link to one piece of work: the Milestones tab, in the given view,
 * with the item's drawer open. Notifications, emails and the activity log all
 * build links here, so the scheme changes in one place.
 */
export function workItemHref(
  projectId: string,
  itemId: string | null,
  side: BoardSide,
  view: WorkView = "board",
): string {
  const base = side === "ADMIN" ? `/admin/projects/${projectId}` : `/portal/projects/${projectId}`;
  const params = new URLSearchParams({ tab: WORK_TAB, view });
  if (itemId) params.set("item", itemId);
  return `${base}?${params}`;
}

/** @deprecated The v48 helper, in its old argument order. Returns the new URL. */
export function boardTaskHref(side: BoardSide, projectId: string, taskId: string): string {
  return workItemHref(projectId, taskId, side, "board");
}

export type WorkLink = { tab: string | null; view: WorkView | null; itemId: string | null };

/**
 * Reads a project page's query string, old links included. v49 put the board
 * and the list on one Milestones tab (?tab=milestones&view=board|list&item=),
 * but notifications and emails already sent carry the older shapes:
 *
 *   ?tab=board&task=<id>    an admin board card (v48)    → Milestones, board
 *   ?tab=milestones         the admin milestone list     → Milestones, list
 *   ?tab=requests           the admin's Requests tab     → Milestones, list (its
 *                           Requested section is where requests are decided now)
 *   ?view=board&task=<id>   a portal board card (v48)    → Milestones, board
 *   ?view=timeline          the portal timeline          → Milestones, list
 *   ?view=files|billing     portal tabs, before ?tab=    → that tab
 *   ?task=<id>              a card from My Work          → Milestones
 *
 * A null tab or view means "not named": the page's default, or the viewer's
 * remembered view.
 */
export function resolveWorkLink(params: { get(name: string): string | null }): WorkLink {
  const itemId = params.get("item") || params.get("task") || null;
  const rawTab = params.get("tab") || null;
  const rawView = params.get("view") || null;

  let tab = rawTab;
  let view: WorkView | null = isWorkView(rawView) ? rawView : null;

  if (rawView === "timeline") {
    view = "list";
    tab = tab ?? WORK_TAB;
  } else if (rawView && !view && !tab) {
    // The portal named its tabs in ?view= before v49.
    tab = rawView;
  }

  if (tab === "board") {
    tab = WORK_TAB;
    view = view ?? "board";
  } else if (tab === "timeline" || tab === "requests") {
    tab = WORK_TAB;
    view = view ?? "list";
  } else if (tab === WORK_TAB && !view && !itemId) {
    // ?tab=milestones alone was the admin's list tab.
    view = "list";
  }

  if (!tab && (view || itemId)) tab = WORK_TAB;
  return { tab, view, itemId };
}

/* ------------------------------------------------------------------------ */
/* The poll's change token                                                   */
/* ------------------------------------------------------------------------ */

/** The aggregates one raw query reads for workVersion (see the DAL). */
export type WorkVersionRow = {
  itemsAt: Date | null;
  items: number;
  commentsAt: Date | null;
  comments: number;
  hours: number;
  /** The hours weighted by item, so moving hours between items shows. */
  hoursMix: number;
  entries: number;
  billedAt: Date | null;
  billed: number;
};

/**
 * The board poll's change token: one number for everything a card or row can
 * show that can change — the items themselves (any update bumps updatedAt;
 * archiving or adding changes the count), their threads (a new comment, a
 * resolved help request, a deleted comment), logged hours and which items
 * they're on, and for ADMIN the invoice lines that bill them. Equal tokens
 * mean the viewer already holds the current board, so the poll answers 204
 * with no body.
 */
export function workVersion(row: WorkVersionRow, opts: { billing: boolean }): string {
  const at = (d: Date | null) => (d ? d.getTime() : 0);
  const parts = [
    at(row.itemsAt),
    row.items,
    at(row.commentsAt),
    row.comments,
    Math.round(row.hours * 100),
    Math.round(row.hoursMix * 100),
    row.entries,
  ];
  if (opts.billing) parts.push(at(row.billedAt), row.billed);
  return parts.map((n) => Math.max(0, Math.trunc(n)).toString(36)).join(".");
}

/** Only our own upload route may appear as a comment attachment. */
export const ATTACHMENT_URL = /^\/api\/files\/image\/[A-Za-z0-9._-]+$/;
