import Link from "next/link";
import { getPortalOverview } from "@/lib/dal/portal";
import { PageHeader } from "@/components/page-header";
import { ProjectStatusBadge } from "@/components/status-badges";
import { ProjectProgress } from "@/components/projects/project-progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WelcomeModal } from "@/components/onboarding/welcome-modal";
import { GettingStarted } from "@/components/onboarding/getting-started";
import { UpcomingMeetings } from "@/components/portal/upcoming-meetings";
import { listMyUpcomingMeetings } from "@/lib/dal/meetings";
import { countClientActionItems } from "@/lib/dal/portal-actions";
import { usd, formatDate, projectTypeLabels } from "@/lib/format";
import { ArrowRight, Bell, FileText } from "lucide-react";

export const metadata = { title: "Overview" };

export default async function PortalOverviewPage() {
  const [{ user, onboardedAt, projects, openInvoices, notifications, checklist }, meetings] =
    await Promise.all([getPortalOverview(), listMyUpcomingMeetings()]);
  const pendingActions = await countClientActionItems(user.id);
  const openTotal = openInvoices.reduce((sum, inv) => sum + Number(inv.amount), 0);

  return (
    <div>
      {/* First login only — a 3-step tour of the portal. */}
      {!onboardedAt && <WelcomeModal firstName={user.firstName} />}

      <PageHeader
        title={`Hi ${user.firstName || user.name}`}
        description="Here's where your projects stand."
      />

      {/* Needs you — the one thing to lead with when something is waiting. */}
      {pendingActions > 0 && (
        <Link
          href="/portal/actions"
          className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-primary/25 bg-brand-tint/50 px-5 py-4 transition-colors hover:bg-brand-tint dark:bg-primary/10 dark:hover:bg-primary/15"
        >
          <span className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
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
                <Card className="transition-shadow hover:shadow-md">
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
