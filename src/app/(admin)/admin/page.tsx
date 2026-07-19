import Link from "next/link";
import { getAdminDashboard, getTodayItems } from "@/lib/dal/dashboard";
import { getPipelineSummary } from "@/lib/dal/leads";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { InvoiceStatusDonut } from "@/components/charts-lazy";
import { ProjectStatusBadge } from "@/components/status-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usd, projectTypeLabels, formatDate } from "@/lib/format";
import { formatDistanceToNow } from "date-fns";
import { requireAdmin } from "@/lib/dal/session";
import {
  FolderKanban,
  TrendingUp,
  Receipt,
  Inbox,
  Clock,
  CalendarClock,
  Activity,
  ArrowRight,
} from "lucide-react";

export const metadata = { title: "Dashboard" };

function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export default async function AdminDashboardPage() {
  await requireAdmin();
  const [data, pipeline, today] = await Promise.all([
    getAdminDashboard(),
    getPipelineSummary(),
    getTodayItems(),
  ]);

  return (
    <div>
      <PageHeader title="Dashboard" description="Your agency overview at a glance." />

      {/* Today: the things that actually need you */}
      {today.length > 0 && (
        <div className="mb-6 rounded-xl border border-primary/25 bg-brand-tint/40 p-5">
          <h2 className="font-heading text-base font-semibold">
            {today.length} thing{today.length === 1 ? "" : "s"} need
            {today.length === 1 ? "s" : ""} you today
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {today.map((item, i) => (
              <li key={i}>
                <Link
                  href={item.link}
                  className="flex items-start gap-2.5 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
                >
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${
                      item.kind === "invoice"
                        ? "bg-red-500"
                        : item.kind === "lead"
                          ? "bg-amber-500"
                          : item.kind === "meeting"
                            ? "bg-sky-500"
                            : "bg-emerald-500"
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {item.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {item.detail}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Revenue this month"
          value={usd.format(data.revenueThisMonth)}
          icon={<TrendingUp className="size-5" />}
          iconClassName="bg-success-tint text-success"
        />
        <StatCard
          label="Outstanding"
          value={usd.format(data.outstanding)}
          icon={<Receipt className="size-5" />}
          iconClassName="bg-amber-50 text-amber-600"
        />
        <StatCard
          label="Active projects"
          value={String(data.activeProjects)}
          icon={<FolderKanban className="size-5" />}
          iconClassName="bg-brand-tint text-primary"
        />
        <StatCard
          label="Hours this month"
          value={fmtHours(data.hoursThisMonth)}
          icon={<Clock className="size-5" />}
          iconClassName="bg-info-tint text-info"
        />
      </div>

      {/* Action strip: things needing attention */}
      {(pipeline.open > 0 || data.pendingRequests > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {pipeline.open > 0 && (
            <Link
              href="/admin/leads"
              className="flex items-center justify-between rounded-xl border bg-card px-5 py-3.5 transition-colors hover:bg-muted/50"
            >
              <span className="text-sm">
                <span className="font-semibold">{pipeline.open}</span> open lead
                {pipeline.open === 1 ? "" : "s"}
                {pipeline.overdue > 0 && (
                  <span className="ml-2 font-semibold text-red-600">
                    · {pipeline.overdue} follow-up{pipeline.overdue === 1 ? "" : "s"} overdue
                  </span>
                )}
              </span>
              <ArrowRight className="size-4 text-primary" />
            </Link>
          )}
          {data.pendingRequests > 0 && (
            <Link
              href="/admin/task-requests"
              className="flex items-center justify-between rounded-xl border bg-card px-5 py-3.5 transition-colors hover:bg-muted/50"
            >
              <span className="flex items-center gap-2 text-sm">
                <Inbox className="size-4 text-primary" />
                <span className="font-semibold">{data.pendingRequests}</span> task request
                {data.pendingRequests === 1 ? "" : "s"} pending
              </span>
              <ArrowRight className="size-4 text-primary" />
            </Link>
          )}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="font-heading text-lg">Recent Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentProjects.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No projects yet — create your first one from the Projects page.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentProjects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell>
                        <Link
                          href={`/admin/projects/${project.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {project.projectName}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {projectTypeLabels[project.type]}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {project.client
                          ? `${project.client.firstName} ${project.client.lastName}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <ProjectStatusBadge status={project.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Invoice Status</CardTitle>
          </CardHeader>
          <CardContent>
            <InvoiceStatusDonut data={data.invoicesByStatus} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading flex items-center gap-2 text-lg">
              <CalendarClock className="size-4 text-primary" /> Invoices due soon
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.upcomingInvoices.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing due in the next 7 days.
              </p>
            ) : (
              <ul className="divide-y">
                {data.upcomingInvoices.map((inv) => {
                  const overdue = new Date(inv.dueDate) < new Date();
                  return (
                    <li key={inv.id} className="flex items-center justify-between py-2.5">
                      <div className="min-w-0">
                        <Link
                          href={`/admin/invoices/${inv.id}`}
                          className="text-sm font-medium hover:text-primary"
                        >
                          {inv.invoiceNumber}
                        </Link>
                        <p className="text-xs text-muted-foreground">{inv.clientName}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{usd.format(inv.amount)}</p>
                        <p
                          className={`text-xs ${overdue ? "font-semibold text-red-600" : "text-muted-foreground"}`}
                        >
                          {overdue ? "overdue · " : "due "}
                          {formatDate(inv.dueDate)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading flex items-center gap-2 text-lg">
              <Activity className="size-4 text-primary" /> Recent activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentActivity.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No activity yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {data.recentActivity.map((n) => {
                  const body = (
                    <>
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      <div className="min-w-0">
                        <p className="text-sm leading-snug">{n.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </>
                  );
                  return (
                    <li key={n.id}>
                      {n.link ? (
                        <Link href={n.link} className="flex gap-2.5 hover:opacity-80">
                          {body}
                        </Link>
                      ) : (
                        <div className="flex gap-2.5">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
