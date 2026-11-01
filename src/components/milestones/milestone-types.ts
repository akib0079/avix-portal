import type { MilestoneStatus, PricingType, ProjectTaskStatus } from "@prisma/client";
import type { JSONContent } from "@tiptap/react";
import type { WorkItem } from "@/lib/board";

/** Serialized time entry safe for client components (no Decimal/Date). */
export type TimeEntryView = {
  id: string;
  date: string; // "YYYY-MM-DD"
  hours: number;
  note: string | null;
};

/**
 * A work item as the Milestones list and the portal timeline draw it. Built
 * from the same WorkItem the board uses (getWorkItems), so the list carries
 * no description or time entries of its own: those load with the item when
 * someone opens it (useWorkItemDetail), and stay null / empty until then.
 */
export type MilestoneView = {
  id: string;
  title: string;
  status: MilestoneStatus;
  stage: ProjectTaskStatus;
  position: number;
  parentId: string | null;
  description: JSONContent | null;
  hasDescription: boolean;
  pricingType: PricingType;
  hourlyRate: number | null;
  estimatedHours: number | null;
  fixedPrice: number | null;
  loggedHours: number;
  timeEntries: TimeEntryView[];
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null; // "YYYY-MM-DD"
  clientApprovedAt: string | null; // ISO date
  clientRating: number | null; // 1 = 👍, -1 = 👎, null = not rated
  clientRatingNote: string | null;
};

export function toMilestoneView(item: WorkItem): MilestoneView {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    stage: item.stage,
    position: item.position,
    parentId: item.parentId,
    description: null,
    hasDescription: item.hasDescription,
    pricingType: item.pricingType,
    hourlyRate: item.hourlyRate,
    estimatedHours: item.estimatedHours,
    fixedPrice: item.fixedPrice,
    loggedHours: item.loggedHours,
    timeEntries: [],
    assigneeId: item.assigneeId,
    assigneeName: item.assignee?.name ?? null,
    dueDate: item.dueDate,
    clientApprovedAt: item.clientApprovedAt,
    clientRating: item.clientRating,
    clientRatingNote: item.clientRatingNote,
  };
}
