import Link from "next/link";
import { getMyWork } from "@/lib/dal/my-work";
import { PageHeader } from "@/components/page-header";
import { MilestoneStatusBadge, ProjectStatusBadge } from "@/components/status-badges";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireTeam } from "@/lib/dal/session";
import { Clock, FolderKanban, CalendarClock, CheckCircle2, TrendingUp } from "lucide-react";

export const metadata = { title: "My Work" };

function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

/** Overdue → today → this week → later → undated. */
function bucketOf(dueDate: string | null, now: Date): string {
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

const BUCKET_ORDER = ["Overdue", "Today", "This week", "Later", "No date"];

export default async function MyWorkPage() {
  const viewer = await requireTeam();
  const work = await getMyWork();
  const now = new Date();

  const grouped = new Map<string, typeof work.milestones>();
  for (const milestone of work.milestones) {
    const bucket = bucketOf(milestone.dueDate, now);
    grouped.set(bucket, [...(grouped.get(bucket) ?? []), milestone]);
  }

  const trend = work.hoursThisWeek - work.hoursLastWeek;

  return (
    <div>
      <PageHeader
        title="My Work"
        description={`Everything assigned to ${viewer.name || "you"}, soonest first.`}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CheckCircle2 className="size-3.5" /> Open milestones
            </p>
            <p className="font-heading mt-1 text-xl font-bold">{work.milestones.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <FolderKanban className="size-3.5" /> Projects I own
            </p>
            <p className="font-heading mt-1 text-xl font-bold">
              {work.ownedProjects.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-3.5" /> Hours this week
            </p>
            <p className="font-heading mt-1 text-xl font-bold">
              {fmtHours(work.hoursThisWeek)}
              {work.hoursLastWeek > 0 && (
                <span
                  className={cn(
                    "ml-2 inline-flex items-center gap-0.5 text-xs font-normal",
                    trend >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground",
                  )}
                >
                  <TrendingUp className="size-3" />
                  {trend >= 0 ? "+" : ""}
                  {fmtHours(trend)} vs last week
                </span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {work.milestones.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <p className="font-medium">Nothing assigned to you yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Milestones show up here as soon as someone puts your name on
                  them.
                </p>
              </CardContent>
            </Card>
          ) : (
            BUCKET_ORDER.filter((bucket) => grouped.has(bucket)).map((bucket) => (
              <div key={bucket}>
                <h2
                  className={cn(
                    "font-heading mb-2 text-sm font-semibold",
                    bucket === "Overdue" && "text-red-600 dark:text-red-400",
                  )}
                >
                  {bucket}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({grouped.get(bucket)!.length})
                  </span>
                </h2>
                <ul className="space-y-2">
                  {grouped.get(bucket)!.map((m) => (
                    <li key={m.id}>
                      <Link
                        href={`/admin/projects/${m.projectId}`}
                        className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {m.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {m.projectName}
                            {m.clientName ? ` · ${m.clientName}` : ""}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          {m.estimatedHours != null && (
                            <span className="text-xs text-muted-foreground">
                              {fmtHours(m.loggedHours)} / {fmtHours(m.estimatedHours)}
                            </span>
                          )}
                          {m.dueDate && (
                            <span
                              className={cn(
                                "flex items-center gap-1 text-xs",
                                bucket === "Overdue"
                                  ? "font-medium text-red-600 dark:text-red-400"
                                  : "text-muted-foreground",
                              )}
                            >
                              <CalendarClock className="size-3" />
                              {formatDate(m.dueDate)}
                            </span>
                          )}
                          <MilestoneStatusBadge
                            status={
                              m.status as Parameters<
                                typeof MilestoneStatusBadge
                              >[0]["status"]
                            }
                          />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="xl:sticky xl:top-16 xl:self-start">
          <Card>
            <CardContent className="pt-6">
              <h2 className="font-heading mb-3 text-base font-semibold">
                Projects I own
              </h2>
              {work.ownedProjects.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  You don&apos;t own any projects yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {work.ownedProjects.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/admin/projects/${p.id}`}
                        className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"
                      >
                        <span className="block truncate text-sm font-medium">
                          {p.projectName}
                        </span>
                        <span className="mt-1 flex items-center gap-2">
                          <ProjectStatusBadge
                            status={
                              p.status as Parameters<
                                typeof ProjectStatusBadge
                              >[0]["status"]
                            }
                          />
                          {p.dueDate && (
                            <span className="text-xs text-muted-foreground">
                              {formatDate(p.dueDate)}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
