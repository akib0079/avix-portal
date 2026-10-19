import type {
  CampaignStatus,
  InvoiceStatus,
  LeadStage,
  MilestoneStatus,
  Priority,
  ProposalStatus,
  ProjectStatus,
  TaskRequestStatus,
} from "@prisma/client";

/**
 * One colour per status, everywhere.
 *
 * The project board gave every column a single hue — slate for backlog, blue
 * for to-do, brand orange for work in flight, violet for review, green for
 * done — and that hue is used for the column's pill, its tint, its cards'
 * leading edge and its drop highlight. This file extends the same vocabulary
 * to every other status in the admin, so "In review" is violet whether it is
 * a board card, a project, an invoice or a milestone, and a column of
 * invoices reads the same way as a column of tasks.
 *
 * Values are CSS colours, not class names: they are set as a `--col` custom
 * property and mixed with `color-mix()`, which is what lets one value drive
 * a solid pill, a 4% lane tint and a 45% hover border without a class per
 * shade. `var(--brand)` keeps a custom branding colour flowing through.
 *
 * Dependency-free so server and client components can both import it.
 */

export const HUE = {
  slate: "#94a3b8",
  blue: "#3b82f6",
  brand: "var(--brand)",
  violet: "#8b5cf6",
  green: "#16a34a",
  amber: "#f59e0b",
  red: "#e2445c",
  sky: "#0ea5e9",
  muted: "#64748b",
} as const;

export const projectStatusColor: Record<ProjectStatus, string> = {
  PLANNING: HUE.slate,
  IN_PROGRESS: HUE.brand,
  REVIEW: HUE.violet,
  COMPLETED: HUE.green,
};

export const milestoneStatusColor: Record<MilestoneStatus, string> = {
  PENDING: HUE.slate,
  IN_PROGRESS: HUE.brand,
  COMPLETED: HUE.green,
};

export const invoiceStatusColor: Record<InvoiceStatus, string> = {
  ASSIGNED: HUE.slate,
  SENT: HUE.blue,
  IN_REVIEW: HUE.violet,
  PARTIALLY_PAID: HUE.amber,
  PAID: HUE.green,
  CANCELLED: HUE.muted,
};

export const taskRequestStatusColor: Record<TaskRequestStatus, string> = {
  PENDING: HUE.amber,
  APPROVED: HUE.green,
  REJECTED: HUE.red,
};

export const leadStageColor: Record<LeadStage, string> = {
  NEW: HUE.sky,
  CONTACTED: HUE.amber,
  PROPOSAL: HUE.violet,
  WON: HUE.green,
  LOST: HUE.slate,
};

export const proposalStatusColor: Record<ProposalStatus, string> = {
  DRAFT: HUE.slate,
  SENT: HUE.blue,
  ACCEPTED: HUE.green,
  DECLINED: HUE.red,
  EXPIRED: HUE.amber,
};

export const campaignStatusColor: Record<CampaignStatus, string> = {
  DRAFT: HUE.slate,
  SCHEDULED: HUE.violet,
  QUEUED: HUE.blue,
  SENDING: HUE.blue,
  SENT: HUE.green,
  FAILED: HUE.red,
};

/** Matches PRIORITY_META on the board, so a flag and a pill agree. */
export const priorityColor: Record<Priority, string> = {
  HIGH: HUE.red,
  MEDIUM: HUE.amber,
  LOW: HUE.muted,
};
