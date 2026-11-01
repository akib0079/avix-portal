import type { ProjectTaskStatus, TaskRequestStatus } from "@prisma/client";
import {
  BOARD_COLUMNS,
  COLUMN_BY_ID,
  canMoveWorkItem,
  positionBetween,
  type BoardPerson,
  type BoardPhase,
  type BoardSide,
  type WorkItem,
  type WorkRole,
} from "@/lib/board";
import { isFinishedStage } from "@/lib/work-stage";

/**
 * How the Milestones tab arranges one project's work items: the plan with its
 * phases, the groupings, the numbers a row shows, and what a request's
 * history line says. Pure and dependency-free (types only), so the list, the
 * board, the drawer and the portal all arrange the same items the same way,
 * and the rules are tested once (work-list.test.ts).
 */

/* ------------------------------------------------------------------------ */
/* The plan                                                                 */
/* ------------------------------------------------------------------------ */

/** Plan order: position, then age — two items can share a position for a moment. */
export function byPlan(
  a: Pick<WorkItem, "position" | "createdAt">,
  b: Pick<WorkItem, "position" | "createdAt">,
): number {
  return a.position - b.position || a.createdAt.localeCompare(b.createdAt);
}

/** A top-level item and the accepted work under it, in plan order. */
export type PlanRow = { item: WorkItem; children: WorkItem[] };

export type PlanTree = {
  /** Client requests waiting for a decision. Not plan yet, so pinned above it. */
  requested: WorkItem[];
  /** Top-level items in plan order, each with its accepted sub-items. */
  rows: PlanRow[];
};

/**
 * The plan as the list draws it. Phases are one level deep (see parentProblem
 * in board.ts); anything that breaks that shape — a sub-item whose phase is
 * archived, or one nested a level too deep by hand — is shown at the top
 * level rather than lost. A request waiting under a phase sits with the other
 * requests until it's accepted.
 */
export function planTree(items: readonly WorkItem[]): PlanTree {
  const live = items.filter((i) => !i.archivedAt);
  const requested = live.filter((i) => i.stage === "REQUESTED").sort(byPlan);
  const accepted = live.filter((i) => i.stage !== "REQUESTED");
  const byId = new Map(accepted.map((i) => [i.id, i]));
  const rootish = (i: WorkItem) => !i.parentId || !byId.has(i.parentId);

  const under = new Map<string, WorkItem[]>();
  const top: WorkItem[] = [];
  for (const item of accepted) {
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    if (parent && !rootish(item) && rootish(parent)) {
      under.set(parent.id, [...(under.get(parent.id) ?? []), item]);
    } else {
      top.push(item);
    }
  }
  return {
    requested,
    rows: top.sort(byPlan).map((item) => ({
      item,
      children: (under.get(item.id) ?? []).sort(byPlan),
    })),
  };
}

/**
 * Every live item in the order the plan writes it (reorderMilestones): each
 * top-level row followed by its work, requests last. Children always follow
 * their phase, so a flat "position" reads the same as the indented list.
 */
export function planOrder(tree: PlanTree): string[] {
  return [
    ...tree.rows.flatMap((r) => [r.item.id, ...r.children.map((c) => c.id)]),
    ...tree.requested.map((i) => i.id),
  ];
}

function moveIndex<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * A drag in the plan: `activeId` takes `overId`'s place among its siblings —
 * top-level rows among themselves, or the work inside one phase. Anything
 * else (onto another phase's work, onto itself) is no move: null. Moving
 * work between phases is the phase picker's job, where it's deliberate.
 */
export function reorderPlan(tree: PlanTree, activeId: string, overId: string): PlanTree | null {
  if (activeId === overId) return null;
  const from = tree.rows.findIndex((r) => r.item.id === activeId);
  const to = tree.rows.findIndex((r) => r.item.id === overId);
  if (from >= 0 && to >= 0) return { ...tree, rows: moveIndex(tree.rows, from, to) };

  for (const row of tree.rows) {
    const a = row.children.findIndex((c) => c.id === activeId);
    const b = row.children.findIndex((c) => c.id === overId);
    if (a >= 0 && b >= 0) {
      return {
        ...tree,
        rows: tree.rows.map((r) => (r === row ? { ...r, children: moveIndex(r.children, a, b) } : r)),
      };
    }
  }
  return null;
}

/**
 * What other work can be grouped under: live, accepted, top-level items, in
 * plan order — the same rule as phasesOf in the DAL, applied to the items a
 * page already holds, so a phase added a moment ago is pickable at once.
 */
export function planPhases(items: readonly WorkItem[]): BoardPhase[] {
  return items
    .filter((i) => !i.parentId && !i.archivedAt && i.stage !== "REQUESTED")
    .sort(byPlan)
    .map((i) => ({ id: i.id, title: i.title }));
}

/** The new plan positions, applied to the items (an optimistic reorder). */
export function withPlanPositions(items: readonly WorkItem[], order: readonly string[]): WorkItem[] {
  const index = new Map(order.map((id, i) => [id, i]));
  return items.map((item) => {
    const position = index.get(item.id);
    return position === undefined || position === item.position ? item : { ...item, position };
  });
}

/**
 * A phase's progress: how much of its work the team has finished. In review
 * counts as finished, the same rule as the project's progress ring — the
 * team's part is done, the client is checking it.
 */
export function phaseProgress(children: readonly Pick<WorkItem, "stage">[]): {
  done: number;
  total: number;
  percent: number;
} {
  const total = children.length;
  const done = children.filter((c) => isFinishedStage(c.stage)).length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/* ------------------------------------------------------------------------ */
/* Groupings                                                                */
/* ------------------------------------------------------------------------ */

export type ListGrouping = "plan" | "stage" | "assignee";
export const LIST_GROUPINGS = ["plan", "stage", "assignee"] as const;

export type ItemGroup = {
  key: string;
  label: string;
  /** The group's hue (a stage colour), or null for people. */
  color: string | null;
  person: BoardPerson | null;
  items: WorkItem[];
};

/**
 * Accepted work by board column, in the board's own order inside each, so
 * the list grouped by stage reads exactly like the board turned on its side.
 * Requests are pinned separately and empty stages are left out.
 */
export function stageGroups(items: readonly WorkItem[], side: BoardSide): ItemGroup[] {
  return BOARD_COLUMNS.filter((c) => c.id !== "REQUESTED")
    .map((c) => ({
      key: c.id,
      label: side === "CLIENT" ? c.clientLabel : c.label,
      color: c.color,
      person: null,
      items: items
        .filter((i) => !i.archivedAt && i.stage === c.id)
        .sort((a, b) => a.boardPosition - b.boardPosition),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * Accepted work by who's doing it, people in the board's order (the team,
 * then the client), anyone no longer on the list by the name on the item,
 * and "Unassigned" last — it's the group that needs someone.
 */
export function assigneeGroups(items: readonly WorkItem[], people: readonly BoardPerson[]): ItemGroup[] {
  const accepted = items.filter((i) => !i.archivedAt && i.stage !== "REQUESTED").sort(byPlan);
  const groups = new Map<string, ItemGroup>();
  const order = [...people.map((p) => p.id)];
  for (const item of accepted) {
    const key = item.assigneeId ?? "";
    let group = groups.get(key);
    if (!group) {
      const person = people.find((p) => p.id === item.assigneeId) ?? null;
      group = {
        key: key || "unassigned",
        label: key ? (person?.name ?? item.assignee?.name ?? "Someone") : "Unassigned",
        color: null,
        person,
        items: [],
      };
      groups.set(key, group);
      if (key && !order.includes(key)) order.push(key);
    }
    group.items.push(item);
  }
  return [...order, ""].flatMap((key) => {
    const group = groups.get(key);
    return group ? [group] : [];
  });
}

/* ------------------------------------------------------------------------ */
/* What a row shows                                                         */
/* ------------------------------------------------------------------------ */

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Dollars as a chip says them: no cents unless there are some. */
function chipMoney(value: number): string {
  return Number.isInteger(value) ? usdWhole.format(value) : usdCents.format(value);
}

/**
 * A price as a chip says it — "$400", "$80/h" — or null when unpriced. The
 * full working ("$80/hr × 5h = $400") is the drawer's and the timeline's.
 */
export function priceLabel(
  item: Pick<WorkItem, "pricingType" | "hourlyRate" | "fixedPrice">,
): string | null {
  if (item.pricingType === "FIXED" && item.fixedPrice != null) return chipMoney(item.fixedPrice);
  if (item.pricingType === "HOURLY" && item.hourlyRate != null) return `${chipMoney(item.hourlyRate)}/h`;
  return null;
}

/** "2h", "2.5h" — logged time, as every work surface writes it. */
export function formatHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

/**
 * Logged against estimated, for the hours bar. No estimate (or none this
 * viewer may see — staff never get one) means no bar to fill: ratio null.
 */
export function hoursProgress(
  logged: number,
  estimate: number | null,
): { ratio: number | null; over: boolean } {
  if (estimate == null || estimate <= 0) return { ratio: null, over: false };
  const ratio = logged / estimate;
  return { ratio, over: ratio > 1 };
}

/** The stages this viewer may move an item to from where it is (canMoveWorkItem). */
export function stageChoices(
  role: WorkRole,
  item: Pick<WorkItem, "stage" | "archivedAt">,
): ProjectTaskStatus[] {
  return BOARD_COLUMNS.map((c) => c.id).filter(
    (to) => to !== item.stage && canMoveWorkItem({ role }, item, item.stage, to).ok,
  );
}

export type DueBucket = "Overdue" | "Today" | "This week" | "Later" | "No date";

/** "YYYY-MM-DD" plus whole days, as a calendar day. */
function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** My Work's lanes: overdue → today → the next seven days → later → undated. */
export function dueBucket(dueDate: string | null, today: string): DueBucket {
  if (!dueDate) return "No date";
  if (dueDate < today) return "Overdue";
  if (dueDate === today) return "Today";
  if (dueDate < addDays(today, 7)) return "This week";
  return "Later";
}

/** Where the end of a board column is: a step past its last card (`except` aside). */
export function endOfColumn(items: readonly WorkItem[], stage: ProjectTaskStatus, except?: string): number {
  let max: number | null = null;
  for (const i of items) {
    if (i.stage === stage && i.id !== except && !i.archivedAt && (max == null || i.boardPosition > max)) {
      max = i.boardPosition;
    }
  }
  return positionBetween(max, null);
}

/* ------------------------------------------------------------------------ */
/* A request's history line                                                 */
/* ------------------------------------------------------------------------ */

/** The note withdrawWorkItem leaves on a request its client took back. */
export const WITHDRAWN_NOTE = "Withdrawn by client";

/** How long a declined request stays on the client's "needs you" list. */
export const DECLINED_RECENT_DAYS = 30;

export type RequestOutcome =
  | { kind: "waiting" }
  | { kind: "accepted"; stage: ProjectTaskStatus }
  /** Accepted, and the work has since been archived. */
  | { kind: "closed" }
  | { kind: "declined"; note: string | null }
  | { kind: "withdrawn" };

/**
 * Where a request stands, read from the request (the decision) and its work
 * item (where the work is now). Accepted requests follow their item, so the
 * client's history says "in progress" rather than a frozen "approved".
 */
export function requestOutcome(
  request: { status: TaskRequestStatus; adminNote: string | null },
  item: { stage: ProjectTaskStatus; archivedAt: Date | string | null } | null,
): RequestOutcome {
  if (request.status === "REJECTED") {
    return request.adminNote === WITHDRAWN_NOTE
      ? { kind: "withdrawn" }
      : { kind: "declined", note: request.adminNote };
  }
  if (request.status === "PENDING") return { kind: "waiting" };
  if (!item || item.archivedAt) return { kind: "closed" };
  return { kind: "accepted", stage: item.stage };
}

/** What an accepted request's stage means to the client who asked. */
const ACCEPTED_AS: Record<ProjectTaskStatus, string> = {
  REQUESTED: "waiting for the team",
  BACKLOG: "scheduled for later",
  TODO: "up next",
  IN_PROGRESS: "in progress",
  REVIEW: "ready for your review",
  DONE: "done",
};

/** The history line: "Accepted, in progress", "Declined", "Waiting for the team". */
export function requestLabel(outcome: RequestOutcome, side: BoardSide): string {
  switch (outcome.kind) {
    case "waiting":
      return side === "CLIENT" ? "Waiting for the team" : "Waiting on us";
    case "accepted":
      return side === "CLIENT"
        ? `Accepted, ${ACCEPTED_AS[outcome.stage]}`
        : `Accepted · ${COLUMN_BY_ID[outcome.stage].label}`;
    case "closed":
      return side === "CLIENT" ? "Accepted, since closed" : "Accepted · archived";
    case "declined":
      return "Declined";
    case "withdrawn":
      return side === "CLIENT" ? "You withdrew it" : "Withdrawn";
  }
}
