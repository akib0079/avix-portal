import {
  isAwaitingRating,
  isAwaitingReview,
  isOpenRequest,
  isPlanItem,
} from "@/lib/work-scope";

/**
 * One definition of "how is this project doing", used by both the admin page
 * and the client portal so the two ends can never disagree about it.
 *
 * Dependency-free on purpose: takes already-serialized values, no Prisma types,
 * so client components can import it. Which items count for what comes from
 * work-scope.ts, the same rules the database counts use.
 */

export type HealthTone = "good" | "warn" | "bad" | "neutral";

export type ProjectHealth = {
  /** Completed plan items / total, 0–100 (see PLAN_ITEM in work-scope.ts). */
  percent: number;
  done: number;
  total: number;
  /** The milestone the team should be working on next, if any. */
  nextMilestone: { id: string; title: string } | null;
  /** Whole days until the due date; negative when it has passed. */
  daysToDue: number | null;
  overdue: boolean;
  /** Short human label: "On track", "Due in 3 days", "5 days overdue". */
  dueLabel: string | null;
  tone: HealthTone;
};

type MilestoneLike = {
  id: string;
  title: string;
  status: string;
  position?: number;
  /**
   * Since v49 sub-items, archived work and requests still awaiting a
   * decision ride along in the same list; only the plan counts. Callers that
   * load the plan alone may leave these out.
   */
  stage?: string;
  parentId?: string | null;
  archivedAt?: string | Date | null;
};

const DAY_MS = 86_400_000;

/** Whole days between two dates, ignoring the time of day. */
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / DAY_MS);
}

export function projectHealth(input: {
  milestones: MilestoneLike[];
  status: string;
  dueDate?: string | Date | null;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}): ProjectHealth {
  const now = input.now ?? new Date();
  // In review counts as done here: the team has finished it.
  const plan = input.milestones.filter(isPlanItem);
  const total = plan.length;
  const done = plan.filter((m) => m.status === "COMPLETED").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  // In-progress wins over the first pending one — that's what's actually live.
  const ordered = [...plan].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  const next =
    ordered.find((m) => m.status === "IN_PROGRESS") ??
    ordered.find((m) => m.status !== "COMPLETED") ??
    null;

  const due = input.dueDate ? new Date(input.dueDate) : null;
  const validDue = due && !Number.isNaN(due.getTime()) ? due : null;
  const daysToDue = validDue ? daysBetween(now, validDue) : null;
  const finished = input.status === "COMPLETED";
  const overdue = !finished && daysToDue !== null && daysToDue < 0;

  let dueLabel: string | null = null;
  if (validDue && !finished) {
    if (daysToDue! < 0) {
      const late = Math.abs(daysToDue!);
      dueLabel = `${late} day${late === 1 ? "" : "s"} overdue`;
    } else if (daysToDue === 0) {
      dueLabel = "Due today";
    } else {
      dueLabel = `Due in ${daysToDue} day${daysToDue === 1 ? "" : "s"}`;
    }
  } else if (finished) {
    dueLabel = "Delivered";
  }

  let tone: HealthTone = "neutral";
  if (finished) tone = "good";
  else if (overdue) tone = "bad";
  else if (daysToDue !== null && daysToDue <= 7) tone = "warn";
  else if (total > 0) tone = "good";

  return {
    percent,
    done,
    total,
    nextMilestone: next ? { id: next.id, title: next.title } : null,
    daysToDue,
    overdue,
    dueLabel,
    tone,
  };
}

/**
 * What the other side is waiting on. Drives the admin attention strip and the
 * client's "Needs you" block from the same counts.
 */
export type PendingWork = {
  /** Work in review, waiting for the client's verdict. */
  milestonesAwaitingApproval: number;
  /** Approved top-level work with no rating yet. */
  milestonesAwaitingRating: number;
  /** Deliverables with no review decision. */
  deliverablesAwaitingReview: number;
  /** Deliverables the client sent back. */
  deliverablesNeedingChanges: number;
  /** Client requests still waiting in Requested. */
  openRequests: number;
  /** Invoices neither PAID nor CANCELLED. */
  unpaidInvoices: number;
  total: number;
};

export function pendingWork(input: {
  /** Every work item of the project, as getWorkItems returns them. */
  milestones: {
    stage: string;
    parentId: string | null;
    archivedAt: string | null;
    clientApprovedAt: string | null;
    clientRating: number | null;
  }[];
  deliverables: { reviewStatus: string | null }[];
  invoices?: { status: string }[];
}): PendingWork {
  const milestonesAwaitingApproval = input.milestones.filter(isAwaitingReview).length;
  const milestonesAwaitingRating = input.milestones.filter(isAwaitingRating).length;
  const deliverablesAwaitingReview = input.deliverables.filter(
    (d) => d.reviewStatus == null,
  ).length;
  const deliverablesNeedingChanges = input.deliverables.filter(
    (d) => d.reviewStatus === "CHANGES_REQUESTED",
  ).length;
  const openRequests = input.milestones.filter(isOpenRequest).length;
  const unpaidInvoices = (input.invoices ?? []).filter(
    (i) => i.status !== "PAID" && i.status !== "CANCELLED",
  ).length;

  return {
    milestonesAwaitingApproval,
    milestonesAwaitingRating,
    deliverablesAwaitingReview,
    deliverablesNeedingChanges,
    openRequests,
    unpaidInvoices,
    total:
      milestonesAwaitingApproval +
      milestonesAwaitingRating +
      deliverablesAwaitingReview +
      deliverablesNeedingChanges +
      openRequests +
      unpaidInvoices,
  };
}
