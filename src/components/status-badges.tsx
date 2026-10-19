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
import {
  HUE,
  invoiceStatusColor,
  milestoneStatusColor,
  priorityColor,
  projectStatusColor,
  taskRequestStatusColor,
} from "@/lib/status-colors";
import { SoftPill } from "@/components/ui/status-pill";

/*
 * Status badges speak the board's colour language (see lib/status-colors):
 * a tinted pill with a dot in the status's hue. They used to be five
 * unrelated tint classes, so "Review" was amber on a project, violet on a
 * board card and blue on an invoice.
 */

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <SoftPill color={projectStatusColor[status]}>{projectStatusLabels[status]}</SoftPill>;
}

export function MilestoneStatusBadge({ status }: { status: MilestoneStatus }) {
  return (
    <SoftPill color={milestoneStatusColor[status]}>{milestoneStatusLabels[status]}</SoftPill>
  );
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <SoftPill color={invoiceStatusColor[status]} strike={status === "CANCELLED"}>
      {invoiceStatusLabels[status]}
    </SoftPill>
  );
}

export function TaskRequestStatusBadge({ status }: { status: TaskRequestStatus }) {
  return (
    <SoftPill color={taskRequestStatusColor[status]}>{taskRequestStatusLabels[status]}</SoftPill>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <SoftPill color={priorityColor[priority]}>{priorityLabels[priority]}</SoftPill>;
}

export function UserStatusBadge({ status }: { status: "ACTIVE" | "INACTIVE" }) {
  return (
    <SoftPill color={status === "ACTIVE" ? HUE.green : HUE.muted}>
      {status === "ACTIVE" ? "Active" : "Inactive"}
    </SoftPill>
  );
}

export function InviteBadge({ emailVerified }: { emailVerified: boolean }) {
  if (emailVerified) return null;
  return <SoftPill color={HUE.brand}>Invite pending</SoftPill>;
}
