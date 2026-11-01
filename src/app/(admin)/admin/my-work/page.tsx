import Link from "next/link";
import type { CSSProperties } from "react";
import type { ProjectStatus } from "@prisma/client";
import { getMyWork } from "@/lib/dal/my-work";
import { PageHeader } from "@/components/page-header";
import { ProjectStatusBadge } from "@/components/status-badges";
import { MyWorkLanes } from "@/components/my-work/my-work-lanes";
import { projectStatusColor } from "@/lib/status-colors";
import { formatDate } from "@/lib/format";
import { formatHours } from "@/lib/work-list";
import { cn } from "@/lib/utils";
import { requireTeam } from "@/lib/dal/session";
import {
  Clock,
  FolderKanban,
  CheckCircle2,
  TrendingUp,
  KanbanSquare,
} from "lucide-react";
import { toneText } from "@/lib/tone";

export const metadata = { title: "My Work" };

/** "YYYY-MM-DD" of a local date, so due days compare as the days they name. */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

export default async function MyWorkPage() {
  const [viewer, work] = await Promise.all([requireTeam(), getMyWork()]);
  const items = work.items;

  const trend = work.hoursThisWeek - work.hoursLastWeek;
  const helpCount = items.filter((t) => t.clientNeedsHelp).length;
  const inReview = items.filter((t) => t.stage === "REVIEW").length;

  return (
    <div>
      <PageHeader
        title="My Work"
        description={`Everything with ${viewer.name || "your"}${viewer.name ? "'s" : ""} name on it, across every project, soonest first — move each one along from here.`}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          icon={CheckCircle2}
          label="Open items"
          value={items.length}
          extra={
            helpCount > 0 ? (
              <span className={cn("ml-2 text-xs font-medium", toneText.bad)}>
                {helpCount} need help
              </span>
            ) : undefined
          }
        />
        <Tile icon={KanbanSquare} label="With the client" value={inReview} />
        <Tile icon={FolderKanban} label="Projects I own" value={work.ownedProjects.length} />
        <Tile
          icon={Clock}
          label="Hours this week"
          value={formatHours(work.hoursThisWeek)}
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
                {formatHours(trend)}
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
            Work shows up here as soon as someone puts your name on it.
          </p>
        </div>
      ) : (
        <MyWorkLanes
          items={items}
          // Bucketed by the server's calendar day, as this page always was.
          today={localDay(new Date())}
          role={viewer.role === "ADMIN" ? "ADMIN" : "STAFF"}
        />
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
