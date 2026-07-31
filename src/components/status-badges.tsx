import { cn } from "@/lib/utils";
import type {
  ProjectStatus,
  MilestoneStatus,
  InvoiceStatus,
  TaskRequestStatus,
  Priority,
} from "@prisma/client";
import {
  projectStatusLabels,
  milestoneStatusLabels,
  invoiceStatusLabels,
  taskRequestStatusLabels,
  priorityLabels,
} from "@/lib/format";

function Pill({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

const projectStatusStyles: Record<ProjectStatus, string> = {
  PLANNING: "bg-muted text-foreground",
  IN_PROGRESS: "bg-info-tint text-info",
  REVIEW: "bg-warning-tint text-warning",
  COMPLETED: "bg-success-tint text-success",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Pill className={projectStatusStyles[status]}>{projectStatusLabels[status]}</Pill>;
}

const milestoneStatusStyles: Record<MilestoneStatus, string> = {
  PENDING: "bg-muted text-foreground",
  IN_PROGRESS: "bg-info-tint text-info",
  COMPLETED: "bg-success-tint text-success",
};

export function MilestoneStatusBadge({ status }: { status: MilestoneStatus }) {
  return <Pill className={milestoneStatusStyles[status]}>{milestoneStatusLabels[status]}</Pill>;
}

const invoiceStatusStyles: Record<InvoiceStatus, string> = {
  ASSIGNED: "bg-muted text-foreground",
  SENT: "bg-info-tint text-info",
  IN_REVIEW: "bg-warning-tint text-warning",
  PARTIALLY_PAID: "bg-info-tint text-info",
  PAID: "bg-success-tint text-success",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Pill className={invoiceStatusStyles[status]}>{invoiceStatusLabels[status]}</Pill>;
}

const taskRequestStatusStyles: Record<TaskRequestStatus, string> = {
  PENDING: "bg-warning-tint text-warning",
  APPROVED: "bg-success-tint text-success",
  REJECTED: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
};

export function TaskRequestStatusBadge({ status }: { status: TaskRequestStatus }) {
  return (
    <Pill className={taskRequestStatusStyles[status]}>
      {taskRequestStatusLabels[status]}
    </Pill>
  );
}

const priorityStyles: Record<Priority, string> = {
  HIGH: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  MEDIUM: "bg-warning-tint text-warning",
  LOW: "bg-muted text-foreground",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Pill className={priorityStyles[priority]}>{priorityLabels[priority]}</Pill>;
}

export function UserStatusBadge({ status }: { status: "ACTIVE" | "INACTIVE" }) {
  return (
    <Pill
      className={
        status === "ACTIVE" ? "bg-success-tint text-success" : "bg-muted text-muted-foreground"
      }
    >
      {status === "ACTIVE" ? "Active" : "Inactive"}
    </Pill>
  );
}

export function InviteBadge({ emailVerified }: { emailVerified: boolean }) {
  if (emailVerified) return null;
  return <Pill className="bg-brand-tint text-accent-foreground">Invite pending</Pill>;
}
