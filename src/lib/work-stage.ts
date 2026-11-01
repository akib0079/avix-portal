import type { MilestoneStatus, ProjectTaskStatus } from "@prisma/client";

/**
 * Milestone.stage (the board column) is the truth; Milestone.status is the
 * older three-state view that billing, reports, health and approvals read.
 * Every write that changes one goes through stageWrite() so they never drift.
 */

/** REQUESTED, BACKLOG and TODO are not started; REVIEW means the team finished. */
export function stageToStatus(stage: ProjectTaskStatus): MilestoneStatus {
  switch (stage) {
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "REVIEW":
    case "DONE":
      return "COMPLETED";
    default:
      return "PENDING";
  }
}

/** For callers that still think in the three states. */
export function statusToStage(status: MilestoneStatus): ProjectTaskStatus {
  if (status === "COMPLETED") return "DONE";
  if (status === "IN_PROGRESS") return "IN_PROGRESS";
  return "TODO";
}

/** The team considers it finished: waiting for the client's check, or done. */
export function isFinishedStage(stage: ProjectTaskStatus): boolean {
  return stage === "REVIEW" || stage === "DONE";
}

/**
 * The columns a stage change writes, together. completedAt is stamped on
 * entering REVIEW or DONE, kept when moving between the two, and cleared on
 * leaving them.
 */
export function stageWrite(
  next: ProjectTaskStatus,
  prev?: { stage: ProjectTaskStatus; completedAt: Date | null } | null,
  now: Date = new Date(),
): { stage: ProjectTaskStatus; status: MilestoneStatus; completedAt: Date | null } {
  const keep = prev && isFinishedStage(prev.stage) ? prev.completedAt : null;
  return {
    stage: next,
    status: stageToStatus(next),
    completedAt: isFinishedStage(next) ? (keep ?? now) : null,
  };
}
