import type { Priority, ProjectTaskStatus } from "@prisma/client";
import type { JSONContent } from "@tiptap/react";

/**
 * Shared vocabulary for the project board — safe on both sides of the wire.
 * The server-only reads live in src/lib/dal/project-board.ts.
 */

/** Which side of the relationship a person is on. Matches MessageSenderRole. */
export type BoardSide = "ADMIN" | "CLIENT";

export type BoardColumn = {
  id: ProjectTaskStatus;
  label: string;
  /** What the column means to a client, who reads "Review" as "my turn". */
  clientLabel: string;
  /** Column colour (any CSS colour). Tints and rings are mixed from it in CSS. */
  color: string;
};

/**
 * Five fixed columns. The colours borrow monday's habit of making status
 * readable from across the room. In progress is the brand colour itself, so a
 * custom branding colour set in Settings carries onto the board.
 */
export const BOARD_COLUMNS: BoardColumn[] = [
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

export type BoardMilestone = { id: string; title: string };

/** One card as the board draws it. No description: that loads with the card. */
export type BoardCard = {
  id: string;
  title: string;
  status: ProjectTaskStatus;
  position: number;
  priority: Priority | null;
  /** "YYYY-MM-DD" — a calendar day, not an instant. */
  dueDate: string | null;
  milestoneId: string | null;
  assigneeId: string | null;
  createdById: string | null;
  createdByRole: BoardSide;
  hasDescription: boolean;
  commentCount: number;
  /** Who is waiting on an open help request, if anyone is. */
  helpFrom: BoardSide | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BoardData = {
  cards: BoardCard[];
  people: BoardPerson[];
  milestones: BoardMilestone[];
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

export type BoardTaskDetail = {
  card: BoardCard;
  description: JSONContent | null;
  comments: BoardComment[];
};

/** Gap left between cards so most drags never need a renumber. */
export const POSITION_STEP = 1024;

/**
 * Where a card dropped between two neighbours goes. Midpoints halve the gap on
 * every drop at the same spot; doubles run out after ~50 of those, which the
 * server catches and renumbers (see moveBoardTask).
 */
export function positionBetween(before?: number | null, after?: number | null): number {
  if (before == null && after == null) return POSITION_STEP;
  if (before == null) return after! - POSITION_STEP;
  if (after == null) return before + POSITION_STEP;
  return (before + after) / 2;
}

/** Deep links. The admin page calls the view a tab; the portal calls it a view. */
export function boardTaskHref(side: BoardSide, projectId: string, taskId: string): string {
  return side === "ADMIN"
    ? `/admin/projects/${projectId}?tab=board&task=${taskId}`
    : `/portal/projects/${projectId}?view=board&task=${taskId}`;
}

/** Only our own upload route may appear as a comment attachment. */
export const ATTACHMENT_URL = /^\/api\/files\/image\/[A-Za-z0-9._-]+$/;
