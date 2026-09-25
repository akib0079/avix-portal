import Link from "next/link";
import { getPortalOverview } from "@/lib/dal/portal";
import { requireClient } from "@/lib/dal/session";
import { Greeting, LiveClock } from "@/components/dashboard/greeting";
import { TargetDial } from "@/components/dashboard/instruments";
import { ProjectStatusBadge } from "@/components/status-badges";
import { ProjectProgress } from "@/components/projects/project-progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WelcomeModal } from "@/components/onboarding/welcome-modal";
import { GettingStarted } from "@/components/onboarding/getting-started";
import { UpcomingMeetings } from "@/components/portal/upcoming-meetings";
import { listMyUpcomingMeetings } from "@/lib/dal/meetings";
import { countClientActionItems } from "@/lib/dal/portal-actions";
import { usd, formatDate, projectTypeLabels } from "@/lib/format";
import { projectHealth } from "@/lib/project-health";
import { cn } from "@/lib/utils";
import { ArrowRight, Bell, FileText } from "lucide-react";
import { toneChip } from "@/lib/tone";

export const metadata = { title: "Overview" };

export default async function PortalOverviewPage() {
  // The action count used to wait for the overview to finish just to learn the
  // user id; the session is already cached, so all three run together.
  const me = await requireClient();
  const [
    { user, onboardedAt, projects, openInvoices, notifications, checklist },
    meetings,
    pendingActions,
  ] = await Promise.all([
    getPortalOverview(),
    listMyUpcomingMeetings(),
    countClientActionItems(me.id),
  ]);
  // Balance owed, not headline totals — a part-paid invoice isn't fully open.
  const openTotal = openInvoices.reduce(
    (sum, inv) => sum + Math.max(Number(inv.amount) - Number(inv.amountPaid), 0),
    0,
  );
  const overdueCount = openInvoices.filter(
    (inv) => inv.dueDate && new Date(inv.dueDate) < new Date(),
  ).length;
  const milestonesTotal = projects.reduce((n, p) => n + p.milestones.length, 0);
  const milestonesDone = projects.reduce(
    (n, p) => n + p.milestones.filter((m) => m.status === "COMPLETED").length,
    0,
  );
  const deliveredPct =
    milestonesTotal > 0 ? Math.round((milestonesDone / milestonesTotal) * 100) : 0;
  const liveProjects = projects.filter((p) => p.status !== "COMPLETED").length;

  return (
    <div>
      {/* First login only — a 3-step tour of the portal. */}
      {!onboardedAt && <WelcomeModal firstName={user.firstName} />}

      <header className="rise mb-6">
        <LiveClock />
        <div className="mt-3">
          <Greeting name={user.firstName || user.name} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Here&apos;s where your projects stand.
        </p>
      </header>

      {/* The deck: everything a client wants to know in one glance. */}
      {projects.length > 0 && (
        <section
          aria-label="Your engagement at a glance"
          className="deck rise mb-6 grid gap-6 p-6 [--i:1] sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:p-8"
        >
          <span className="deck-edge" aria-hidden />
          <div className="relative z-[2] mx-auto size-44">
            <TargetDial value={milestonesDone} target={milestonesTotal} className="size-full" />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="num text-4xl font-bold">
                {deliveredPct}
                <span className="text-lg text-white/50">%</span>
              </span>
              <span className="mt-1 text-[11px] text-white/50">delivered</span>
            </div>
          </div>
          <dl className="relative z-[2] grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-3">
            <div>
              <dt className="eyebrow text-white/45">Milestones</dt>
              <dd className="num mt-1 text-2xl font-semibold">
                {milestonesDone}
                <span className="text-base text-white/45"> / {milestonesTotal}</span>
              </dd>
              <dd className="text-[11px] text-white/40">completed so far</dd>
            </div>
            <div>
              <dt className="eyebrow text-white/45">Live projects</dt>
              <dd className="num mt-1 text-2xl font-semibold">{liveProjects}</dd>
              <dd className="text-[11px] text-white/40">in motion right now</dd>
            </div>
            <div className="col-span-2 lg:col-span-1">
              <dt className="eyebrow flex items-center gap-1.5 text-white/45">
                {overdueCount > 0 && <span className="size-1.5 rounded-full bg-red-400" />}
                Balance due
              </dt>
              <dd className="num mt-1 text-2xl font-semibold">{usd.format(openTotal)}</dd>
              <dd className="text-[11px] text-white/40">
                {openInvoices.length === 0
                  ? "all settled — thank you"
                  : overdueCount > 0
                    ? `${overdueCount} past its due date`
                    : `across ${openInvoices.length} invoice${openInvoices.length === 1 ? "" : "s"}`}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {/* Needs you — the one thing to lead with when something is waiting. */}
      {pendingActions > 0 && (
        <Link
          href="/portal/actions"
          className="surface surface-link rise mb-6 flex items-center justify-between gap-4 px-5 py-4 [--i:2]"
        >
          <span className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-white shadow-[0_8px_20px_-8px] shadow-primary">
              {pendingActions}
            </span>
            <span>
              <span className="block font-heading text-sm font-semibold">
                {pendingActions === 1 ? "1 thing needs you" : `${pendingActions} things need you`}
              </span>
              <span className="block text-xs text-muted-foreground">
                Approvals and invoices waiting on your go-ahead.
              </span>
            </span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-primary" />
        </Link>
      )}

      <GettingStarted state={checklist} />

      <UpcomingMeetings meetings={meetings} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {projects.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No projects yet — once Avix Digital sets one up for you, it
                appears here.
              </CardContent>
            </Card>
          ) : (
            projects.map((project) => (
              <Link key={project.id} href={`/portal/projects/${project.id}`} className="block">
                <Card className="surface-link">
                  <CardContent className="pt-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-heading font-semibold">
                          {project.projectName}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {projectTypeLabels[project.type]}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <ProjectStatusBadge status={project.status} />
                        <ArrowRight className="size-4 text-muted-foreground" />
                      </div>
                    </div>
                    <ProjectProgress milestones={project.milestones} className="mt-4" />
                    {(() => {
                      const health = projectHealth({
                        milestones: project.milestones.map((m, i) => ({
                          id: String(i),
                          title: "",
                          status: m.status,
                          position: i,
                        })),
                        status: project.status,
                        dueDate: project.dueDate,
                      });
                      if (!health.dueLabel) return null;
                      return (
                        <p
                          className={cn(
                            "mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            health.tone === "bad"
                              ? toneChip.bad
                              : health.tone === "warn"
                                ? toneChip.warn
                                : toneChip.good,
                          )}
                        >
                          {health.dueLabel}
                        </p>
                      );
                    })()}
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2 text-lg">
                <FileText className="size-4 text-primary" /> Open invoices
              </CardTitle>
            </CardHeader>
            <CardContent>
              {openInvoices.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing outstanding — you&apos;re all settled.
                </p>
              ) : (
                <>
                  <p className="font-heading text-2xl font-bold">
                    {usd.format(openTotal)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    across {openInvoices.length} invoice
                    {openInvoices.length === 1 ? "" : "s"}
                  </p>
                  {overdueCount > 0 && (
                    <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                      {overdueCount} past its due date
                    </p>
                  )}
                  <Link
                    href="/portal/invoices"
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    View invoices <ArrowRight className="size-3.5" />
                  </Link>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2 text-lg">
                <Bell className="size-4 text-primary" /> Recent updates
              </CardTitle>
            </CardHeader>
            <CardContent>
              {notifications.length === 0 ? (
                <p className="text-sm text-muted-foreground">No updates yet.</p>
              ) : (
                <ul className="space-y-3">
                  {notifications.map((n) => (
                    <li key={n.id} className="text-sm">
                      {n.link ? (
                        <Link href={n.link} className="font-medium hover:text-primary">
                          {n.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{n.title}</span>
                      )}
                      {n.body && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                      )}
                      <p className="text-xs text-muted-foreground/70">
                        {formatDate(n.createdAt)}
                      </p>
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
