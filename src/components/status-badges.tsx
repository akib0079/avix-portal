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
  PLANNING: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-info-tint text-info",
  REVIEW: "bg-warning-tint text-warning",
  COMPLETED: "bg-success-tint text-success",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Pill className={projectStatusStyles[status]}>{projectStatusLabels[status]}</Pill>;
}

const milestoneStatusStyles: Record<MilestoneStatus, string> = {
  PENDING: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-info-tint text-info",
  COMPLETED: "bg-success-tint text-success",
};

export function MilestoneStatusBadge({ status }: { status: MilestoneStatus }) {
  return <Pill className={milestoneStatusStyles[status]}>{milestoneStatusLabels[status]}</Pill>;
}

const invoiceStatusStyles: Record<InvoiceStatus, string> = {
  ASSIGNED: "bg-slate-100 text-slate-700",
  SENT: "bg-info-tint text-info",
  IN_REVIEW: "bg-warning-tint text-warning",
  PAID: "bg-success-tint text-success",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Pill className={invoiceStatusStyles[status]}>{invoiceStatusLabels[status]}</Pill>;
}

const taskRequestStatusStyles: Record<TaskRequestStatus, string> = {
  PENDING: "bg-warning-tint text-warning",
  APPROVED: "bg-success-tint text-success",
  REJECTED: "bg-red-50 text-red-700",
};

export function TaskRequestStatusBadge({ status }: { status: TaskRequestStatus }) {
  return (
    <Pill className={taskRequestStatusStyles[status]}>
      {taskRequestStatusLabels[status]}
    </Pill>
  );
}

const priorityStyles: Record<Priority, string> = {
  HIGH: "bg-red-50 text-red-700",
  MEDIUM: "bg-warning-tint text-warning",
  LOW: "bg-slate-100 text-slate-700",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Pill className={priorityStyles[priority]}>{priorityLabels[priority]}</Pill>;
}

export function UserStatusBadge({ status }: { status: "ACTIVE" | "INACTIVE" }) {
  return (
    <Pill
      className={
        status === "ACTIVE" ? "bg-success-tint text-success" : "bg-slate-100 text-slate-500"
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
