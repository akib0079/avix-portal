"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Priority, ProjectStatus } from "@prisma/client";
import { setProjectStatus, setProjectPriority, setProjectOwner } from "@/lib/actions/projects";
import type { TeamOption } from "@/lib/dal/users";
import { projectHealth } from "@/lib/project-health";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  priorityLabels,
  projectStatusLabels,
  projectTypeLabels,
  projectSourceLabels,
  formatDate,
  usd,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  CalendarDays,
  Pencil,
  Building2,
  ArrowUpRight,
  CircleDot,
  AlertTriangle,
} from "lucide-react";

const STATUSES: ProjectStatus[] = ["PLANNING", "IN_PROGRESS", "REVIEW", "COMPLETED"];
const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH"];

/** Circular progress — reads faster than a bar when it sits in a fixed rail. */
function ProgressRing({ percent }: { percent: number }) {
  const size = 96;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          className="fill-none stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="fill-none stroke-primary transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-heading text-lg font-bold">
        {percent}%
      </span>
    </div>
  );
}

/**
 * The project's fixed context column: who it's for, where it stands, and the
 * actions you reach for while working in the tabs beside it. Status and
 * priority are editable in place — changing them used to mean a trip to the
 * edit form.
 */
export function ProjectRail({
  project,
  milestones,
  team = [],
  canEdit,
  className,
}: {
  project: {
    id: string;
    projectName: string;
    status: ProjectStatus;
    priority: Priority;
    type: keyof typeof projectTypeLabels;
    source: keyof typeof projectSourceLabels;
    startDate: string | null;
    dueDate: string | null;
    billingType: "MILESTONE" | "CONTRACT";
    contractPrice: number | null;
    ownerId: string | null;
    client: {
      id: string;
      firstName: string;
      lastName: string;
      company: string | null;
    } | null;
  };
  milestones: { id: string; title: string; status: string; position: number }[];
  /** Assignable team members (admins + staff). */
  team?: TeamOption[];
  /** ADMIN only — staff see the rail read-only and money-free. */
  canEdit: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [priority, setPriority] = useState<Priority>(project.priority);
  const [owner, setOwner] = useState<string>(project.ownerId ?? "none");

  const health = projectHealth({
    milestones,
    status,
    dueDate: project.dueDate,
  });

  async function changeStatus(next: ProjectStatus) {
    const previous = status;
    setStatus(next); // optimistic — the select shouldn't lag behind the click
    setBusy(true);
    const res = await setProjectStatus(project.id, next);
    setBusy(false);
    if (!res.ok) {
      setStatus(previous);
      return void toast.error(res.error);
    }
    toast.success(`Moved to ${projectStatusLabels[next]}.`);
    router.refresh();
  }

  async function changePriority(next: Priority) {
    const previous = priority;
    setPriority(next);
    setBusy(true);
    const res = await setProjectPriority(project.id, next);
    setBusy(false);
    if (!res.ok) {
      setPriority(previous);
      return void toast.error(res.error);
    }
    router.refresh();
  }

  async function changeOwner(next: string) {
    const previous = owner;
    setOwner(next);
    setBusy(true);
    const res = await setProjectOwner(project.id, next === "none" ? null : next);
    setBusy(false);
    if (!res.ok) {
      setOwner(previous);
      return void toast.error(res.error);
    }
    router.refresh();
  }

  return (
    <div className={cn("rounded-2xl border bg-card p-5", className)}>
      <h1 className="font-heading text-xl leading-tight font-bold">
        {project.projectName}
      </h1>

      {project.client ? (
        <Link
          href={`/admin/clients/${project.client.id}`}
          className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
        >
          <Building2 className="size-3.5 shrink-0" />
          <span className="truncate">
            {project.client.firstName} {project.client.lastName}
            {project.client.company ? ` · ${project.client.company}` : ""}
          </span>
          <ArrowUpRight className="size-3 shrink-0" />
        </Link>
      ) : (
        <p className="mt-1.5 text-sm text-muted-foreground">No client attached</p>
      )}

      <p className="mt-1 text-xs text-muted-foreground">
        {projectTypeLabels[project.type]} · {projectSourceLabels[project.source]}
      </p>

      {/* Progress + where the work stands */}
      <div className="mt-5 flex items-center gap-4">
        <ProgressRing percent={health.percent} />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {health.done} of {health.total} milestones
          </p>
          {health.nextMilestone && status !== "COMPLETED" && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
              <CircleDot className="mt-0.5 size-3 shrink-0 text-primary" />
              <span className="line-clamp-2">Next: {health.nextMilestone.title}</span>
            </p>
          )}
          {health.dueLabel && (
            <p
              className={cn(
                "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                health.tone === "bad"
                  ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                  : health.tone === "warn"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
              )}
            >
              {health.overdue && <AlertTriangle className="size-3" />}
              {health.dueLabel}
            </p>
          )}
        </div>
      </div>

      {/* Status / priority, editable in place */}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Status
          </span>
          <Select
            value={status}
            onValueChange={(v) => changeStatus(v as ProjectStatus)}
            disabled={!canEdit || busy}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {projectStatusLabels[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Priority
          </span>
          <Select
            value={priority}
            onValueChange={(v) => changePriority(v as Priority)}
            disabled={!canEdit || busy}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {priorityLabels[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {canEdit && (
        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Owner
          </span>
          <Select value={owner} onValueChange={changeOwner} disabled={busy}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {team.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.name}
                  {member.role === "STAFF" ? " · staff" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}

      {(project.startDate || project.dueDate) && (
        <p className="mt-4 flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarDays className="size-3.5 shrink-0" />
          {formatDate(project.startDate)} → {formatDate(project.dueDate)}
        </p>
      )}

      {canEdit && project.billingType === "CONTRACT" && (
        <p className="mt-2 text-sm font-medium text-primary">
          {project.contractPrice != null
            ? `${usd.format(project.contractPrice)} fixed contract`
            : "Fixed contract"}
        </p>
      )}

      {canEdit && (
        <Button asChild variant="outline" size="sm" className="mt-5 w-full">
          <Link href={`/admin/projects/${project.id}/edit`}>
            <Pencil /> Edit project
          </Link>
        </Button>
      )}
    </div>
  );
}
