import Link from "next/link";
import type { CSSProperties } from "react";
import type { MilestoneStatus, Priority, ProjectStatus } from "@prisma/client";
import { getMyWork } from "@/lib/dal/my-work";
import { PageHeader } from "@/components/page-header";
import { ProjectStatusBadge } from "@/components/status-badges";
import { Lane, LaneScroller } from "@/components/ui/lanes";
import { COLUMN_BY_ID, PRIORITY_META } from "@/lib/board";
import {
  HUE,
  milestoneStatusColor,
  projectStatusColor,
} from "@/lib/status-colors";
import { formatDate, milestoneStatusLabels } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireTeam } from "@/lib/dal/session";
import {
  Clock,
  FolderKanban,
  CalendarClock,
  CheckCircle2,
  TrendingUp,
  KanbanSquare,
  Flag,
  LifeBuoy,
  Building2,
} from "lucide-react";
import { toneText } from "@/lib/tone";

export const metadata = { title: "My Work" };

function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

type Bucket = "Overdue" | "Today" | "This week" | "Later" | "No date";

/** Overdue → today → this week → later → undated. */
function bucketOf(dueDate: string | null, now: Date): Bucket {
  if (!dueDate) return "No date";
  const due = new Date(dueDate);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  if (due < startOfToday) return "Overdue";
  if (due < endOfToday) return "Today";
  if (due < endOfWeek) return "This week";
  return "Later";
}

const BUCKETS: { name: Bucket; color: string }[] = [
  { name: "Overdue", color: HUE.red },
  { name: "Today", color: HUE.brand },
  { name: "This week", color: HUE.blue },
  { name: "Later", color: HUE.sky },
  { name: "No date", color: HUE.slate },
];

/** A milestone or a board card, flattened so one lane can hold both. */
type Item =
  | {
      kind: "milestone";
      id: string;
      title: string;
      status: MilestoneStatus;
      dueDate: string | null;
      projectId: string;
      projectName: string;
      clientName: string | null;
      loggedHours: number;
      estimatedHours: number | null;
    }
  | {
      kind: "task";
      id: string;
      title: string;
      status: string;
      priority: Priority | null;
      dueDate: string | null;
      projectId: string;
      projectName: string;
      clientName: string | null;
      clientNeedsHelp: boolean;
    };

function Tile({
  icon: Icon,
  label,
  value,
  extra,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div className="surface p-4">
      <p className="eyebrow flex items-center gap-1.5">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className="num mt-1.5 text-2xl font-bold">
        {value}
        {extra}
      </p>
    </div>
  );
}

function ItemCard({ item, bucket }: { item: Item; bucket: Bucket }) {
  const isTask = item.kind === "task";
  const column = isTask ? COLUMN_BY_ID[item.status as keyof typeof COLUMN_BY_ID] : null;
  const hue = isTask
    ? (column?.color ?? HUE.slate)
    : milestoneStatusColor[item.status];
  const href = isTask
    ? `/admin/projects/${item.projectId}?task=${item.id}`
    : `/admin/projects/${item.projectId}?tab=milestones`;

  return (
    <Link
      href={href}
      style={{ "--col": hue } as CSSProperties}
      className="group/card relative block overflow-hidden rounded-xl border bg-card p-3 shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-[box-shadow,border-color] duration-150 outline-none hover:border-[color-mix(in_oklab,var(--col)_45%,var(--border))] hover:shadow-[0_6px_20px_-10px_rgb(15_23_42/0.25)] focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70" />

      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {/* What it is and where it stands, in the board's colours. */}
        <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--col)_13%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[color-mix(in_oklab,var(--col)_72%,var(--foreground))]">
          {isTask ? <KanbanSquare className="size-3" /> : <Flag className="size-3" />}
          {isTask ? (column?.label ?? "Task") : `Milestone · ${milestoneStatusLabels[item.status]}`}
        </span>
        {isTask && item.clientNeedsHelp && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/12 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-red-600 uppercase dark:text-red-400">
            <LifeBuoy className="size-3" /> Needs help
          </span>
        )}
      </div>

      <p className="line-clamp-2 text-[13px] leading-snug font-semibold [overflow-wrap:anywhere]">
        {item.title}
      </p>
      <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
        <Building2 className="size-3 shrink-0" />
        <span className="truncate">
          {item.projectName}
          {item.clientName ? ` · ${item.clientName}` : ""}
        </span>
      </p>

      {(item.dueDate || (isTask && item.priority) || (!isTask && item.estimatedHours != null)) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
          {isTask && item.priority && (
            <span
              className="inline-flex items-center gap-1 font-medium"
              style={{ color: PRIORITY_META[item.priority].color }}
            >
              <Flag className="size-3" fill="currentColor" />
              {PRIORITY_META[item.priority].label}
            </span>
          )}
          {item.dueDate && (
            <span
              className={cn(
                "inline-flex items-center gap-1 tabular-nums",
                bucket === "Overdue" ? cn("font-medium", toneText.bad) : "text-muted-foreground",
              )}
            >
              <CalendarClock className="size-3" />
              {formatDate(item.dueDate)}
            </span>
          )}
          {!isTask && item.estimatedHours != null && (
            <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
              <Clock className="size-3" />
              {fmtHours(item.loggedHours)} / {fmtHours(item.estimatedHours)}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

export default async function MyWorkPage() {
  const viewer = await requireTeam();
  const work = await getMyWork();
  const now = new Date();

  const items: Item[] = [
    ...work.milestones.map((m) => ({
      kind: "milestone" as const,
      ...m,
      status: m.status as MilestoneStatus,
    })),
    ...work.tasks.map((t) => ({ kind: "task" as const, ...t })),
  ];

  const grouped = new Map<Bucket, Item[]>();
  for (const item of items) {
    const bucket = bucketOf(item.dueDate, now);
    grouped.set(bucket, [...(grouped.get(bucket) ?? []), item]);
  }
  // Soonest first inside each lane; undated items keep their source order.
  for (const list of grouped.values()) {
    list.sort((a, b) => (a.dueDate ?? "￿").localeCompare(b.dueDate ?? "￿"));
  }

  const trend = work.hoursThisWeek - work.hoursLastWeek;
  const helpCount = work.tasks.filter((t) => t.clientNeedsHelp).length;

  return (
    <div>
      <PageHeader
        title="My Work"
        description={`Everything assigned to ${viewer.name || "you"} — milestones and board cards — soonest first.`}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={CheckCircle2} label="Milestones" value={work.milestones.length} />
        <Tile
          icon={KanbanSquare}
          label="Board cards"
          value={work.tasks.length}
          extra={
            helpCount > 0 ? (
              <span className={cn("ml-2 text-xs font-medium", toneText.bad)}>
                {helpCount} need help
              </span>
            ) : undefined
          }
        />
        <Tile icon={FolderKanban} label="Projects I own" value={work.ownedProjects.length} />
        <Tile
          icon={Clock}
          label="Hours this week"
          value={fmtHours(work.hoursThisWeek)}
          extra={
            work.hoursLastWeek > 0 ? (
              <span
                className={cn(
                  "ml-2 inline-flex items-center gap-0.5 text-xs font-normal",
                  trend >= 0 ? toneText.good : "text-muted-foreground",
                )}
              >
                <TrendingUp className="size-3" />
                {trend >= 0 ? "+" : ""}
                {fmtHours(trend)}
              </span>
            ) : undefined
          }
        />
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/60 py-16 text-center">
          <CheckCircle2 className="mx-auto mb-3 size-8 text-muted-foreground/40" />
          <p className="font-medium">Nothing assigned to you yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Milestones and board cards show up here as soon as someone puts your name on them.
          </p>
        </div>
      ) : (
        <LaneScroller>
          {BUCKETS.filter((b) => grouped.has(b.name)).map((b) => {
            const list = grouped.get(b.name)!;
            return (
              <Lane
                key={b.name}
                color={b.color}
                title={b.name}
                count={list.length}
                className="lg:min-w-[250px]"
              >
                {list.map((item) => (
                  <ItemCard key={`${item.kind}-${item.id}`} item={item} bucket={b.name} />
                ))}
              </Lane>
            );
          })}
        </LaneScroller>
      )}

      <section className="mt-8">
        <h2 className="title-section mb-3">Projects I own</h2>
        {work.ownedProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">You don&apos;t own any live projects.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {work.ownedProjects.map((p) => {
              const status = p.status as ProjectStatus;
              return (
                <li key={p.id}>
                  <Link
                    href={`/admin/projects/${p.id}`}
                    style={{ "--col": projectStatusColor[status] } as CSSProperties}
                    className="surface surface-link relative block overflow-hidden p-4"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-[3px] bg-[var(--col)] opacity-70"
                    />
                    <span className="block truncate text-sm font-semibold">{p.projectName}</span>
                    <span className="mt-2 flex items-center gap-2">
                      <ProjectStatusBadge status={status} />
                      {p.dueDate && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatDate(p.dueDate)}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
