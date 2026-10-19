"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Priority, ProjectStatus } from "@prisma/client";
import { setProjectStatus, setProjectPriority, setProjectOwner } from "@/lib/actions/projects";
import type { TeamOption } from "@/lib/dal/users";
import { projectHealth } from "@/lib/project-health";
import { projectStatusColor, priorityColor } from "@/lib/status-colors";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/board/board-bits";
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
  ChevronRight,
  ChevronDown,
  KanbanSquare,
  Timer,
  Banknote,
  LifeBuoy,
} from "lucide-react";
import { toneChip } from "@/lib/tone";

const STATUSES: ProjectStatus[] = ["PLANNING", "IN_PROGRESS", "REVIEW", "COMPLETED"];
const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH"];

/** Circular progress — reads faster than a bar beside a block of facts. */
function ProgressRing({ percent, size = 76 }: { percent: number; size?: number }) {
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
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
      <span className="num absolute inset-0 flex items-center justify-center text-base font-bold">
        {percent}%
      </span>
    </div>
  );
}

/** A labelled fact in the header's field row. */
function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="eyebrow mb-1.5 text-[10px]">{label}</p>
      {children}
    </div>
  );
}

/** One figure in the at-a-glance strip. */
function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  tone?: "warn" | "bad";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border bg-muted/40 px-3 py-2">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-sm",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "bad" && "text-red-600 dark:text-red-400",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="num block truncate text-sm font-semibold">{value}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

/** A coloured dot for a select option, so the closed trigger shows the hue too. */
function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full bg-[var(--c)]"
      style={{ "--c": color } as CSSProperties}
    />
  );
}

/**
 * The project's header, across the full width of the page.
 *
 * It used to be a 320px rail beside the tabs, which was fine for a timeline
 * but squeezed the board: five columns in what was left, with Done clipped
 * off the right edge. Everything the rail held is still here — who it's for,
 * progress, status, priority and owner editable in place — laid out as a
 * band, so the workspace below gets every pixel of width.
 */
export function ProjectHeader({
  project,
  milestones,
  team = [],
  canEdit,
  renderedAt,
  stats,
  attention,
  brief,
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
  /** ADMIN only — staff see the header read-only and money-free. */
  canEdit: boolean;
  /** Server time, so "due in N days" matches between server and browser. */
  renderedAt: number;
  stats: {
    openTasks: number;
    doneTasks: number;
    helpRequests: number;
    hoursLogged: number;
    /** Admin only; null hides it. */
    unbilled: number | null;
  };
  /** What's waiting on someone, rendered in the header's footer. */
  attention?: React.ReactNode;
  /** The project brief, folded under the header. */
  brief?: React.ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [priority, setPriority] = useState<Priority>(project.priority);
  const [owner, setOwner] = useState<string>(project.ownerId ?? "none");
  // Phones: owner, dates, billing and the stats fold away so the board is
  // reachable without scrolling past a screen of header. Wider screens show all.
  const [more, setMore] = useState(false);
  const foldable = more ? undefined : "max-sm:hidden";

  const health = projectHealth({
    milestones,
    status,
    dueDate: project.dueDate,
    now: new Date(renderedAt),
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

  const ownerPerson = team.find((m) => m.id === owner);
  const statusColor = projectStatusColor[status];

  return (
    <section
      className="surface overflow-hidden"
      style={{ "--col": statusColor } as CSSProperties}
    >
      {/* Status hue along the top edge — the same signal a board column gives. */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-[var(--col)] opacity-80" />

      <div className="p-5 sm:p-6">
        {/* Breadcrumb + primary action */}
        <div className="flex items-center gap-3">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <Link href="/admin/projects" className="hover:text-foreground">
              Projects
            </Link>
            <ChevronRight className="size-3 shrink-0" />
            <span className="truncate text-foreground/80">{project.projectName}</span>
          </nav>
          {canEdit && (
            <Button asChild variant="outline" size="sm" className="ml-auto shrink-0">
              <Link href={`/admin/projects/${project.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
          )}
        </div>

        <div className="mt-3 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] xl:items-start">
          {/* Identity + progress */}
          <div className="min-w-0">
            <h1 className="title-page text-2xl leading-tight [overflow-wrap:anywhere] sm:text-[1.75rem]">
              {project.projectName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              {project.client ? (
                <Link
                  href={`/admin/clients/${project.client.id}`}
                  className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground hover:text-primary"
                >
                  <Building2 className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {project.client.firstName} {project.client.lastName}
                    {project.client.company ? ` · ${project.client.company}` : ""}
                  </span>
                  <ArrowUpRight className="size-3 shrink-0" />
                </Link>
              ) : (
                <span className="text-muted-foreground">No client attached</span>
              )}
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {projectTypeLabels[project.type]}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {projectSourceLabels[project.source]}
              </span>
            </div>

            <div className="mt-5 flex items-center gap-4">
              <ProgressRing percent={health.percent} />
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {health.done} of {health.total} milestone{health.total === 1 ? "" : "s"} done
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
                        ? toneChip.bad
                        : health.tone === "warn"
                          ? toneChip.warn
                          : toneChip.good,
                    )}
                  >
                    {health.overdue && <AlertTriangle className="size-3" />}
                    {health.dueLabel}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Editable facts */}
          <div className="min-w-0">
            <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
              <Field label="Status">
                <Select
                  value={status}
                  onValueChange={(v) => changeStatus(v as ProjectStatus)}
                  disabled={!canEdit || busy}
                >
                  <SelectTrigger size="sm" className="w-full" aria-label="Status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        <Dot color={projectStatusColor[s]} />
                        {projectStatusLabels[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Priority">
                <Select
                  value={priority}
                  onValueChange={(v) => changePriority(v as Priority)}
                  disabled={!canEdit || busy}
                >
                  <SelectTrigger size="sm" className="w-full" aria-label="Priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        <Dot color={priorityColor[p]} />
                        {priorityLabels[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Owner" className={cn("col-span-2 sm:col-span-1", foldable)}>
                {canEdit ? (
                  <Select value={owner} onValueChange={changeOwner} disabled={busy}>
                    <SelectTrigger size="sm" className="w-full" aria-label="Owner">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {team.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          <PersonAvatar person={member} size={18} />
                          {member.name}
                          {member.role === "STAFF" ? " · staff" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="flex h-7 items-center gap-2 text-sm">
                    <PersonAvatar person={ownerPerson ?? null} size={20} />
                    <span className="truncate">{ownerPerson?.name ?? "Unassigned"}</span>
                  </p>
                )}
              </Field>
              <Field label="Timeline" className={cn("col-span-2 sm:col-span-2", foldable)}>
                <p className="flex h-7 items-center gap-1.5 text-sm">
                  <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
                  {project.startDate || project.dueDate ? (
                    <span className="truncate tabular-nums">
                      {formatDate(project.startDate)} → {formatDate(project.dueDate)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No dates set</span>
                  )}
                </p>
              </Field>
              {canEdit && (
                <Field label="Billing" className={foldable}>
                  <p className="flex h-7 items-center text-sm font-semibold">
                    {project.billingType === "CONTRACT"
                      ? project.contractPrice != null
                        ? `${usd.format(project.contractPrice)} fixed`
                        : "Fixed contract"
                      : "Per milestone"}
                  </p>
                </Field>
              )}
            </div>
          </div>
        </div>

        {/* At a glance — readable from any tab, not just the board. */}
        <div
          className={cn(
            "mt-5 grid grid-cols-2 gap-2",
            stats.unbilled !== null ? "sm:grid-cols-4" : "sm:grid-cols-3",
            foldable,
          )}
        >
          <Stat
            icon={KanbanSquare}
            label={`open · ${stats.doneTasks} done`}
            value={`${stats.openTasks} task${stats.openTasks === 1 ? "" : "s"}`}
          />
          <Stat
            icon={LifeBuoy}
            label="help requests"
            value={stats.helpRequests}
            tone={stats.helpRequests > 0 ? "bad" : undefined}
          />
          <Stat
            icon={Timer}
            label="hours logged"
            value={`${Number.isInteger(stats.hoursLogged) ? stats.hoursLogged : stats.hoursLogged.toFixed(1)}h`}
          />
          {stats.unbilled !== null && (
            <Stat
              icon={Banknote}
              label="ready to bill"
              value={usd.format(stats.unbilled)}
              tone={stats.unbilled > 0 ? "warn" : undefined}
            />
          )}
        </div>

        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          className="mt-4 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:hidden"
        >
          {more ? "Fewer details" : "More details"}
          <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} />
        </button>
      </div>

      {(attention || brief) && (
        <div className="flex flex-col gap-3 border-t bg-muted/30 px-5 py-3 sm:px-6">
          {attention}
          {brief}
        </div>
      )}
    </section>
  );
}
