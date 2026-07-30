import Link from "next/link";
import { getAdminDashboard, getTodayItems, getBusinessHealth } from "@/lib/dal/dashboard";
import { listActivity } from "@/lib/dal/activity";
import { getPipelineSummary } from "@/lib/dal/leads";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { BusinessHealthPanel } from "@/components/dashboard/business-health";
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
  Repeat,
} from "lucide-react";

export const metadata = { title: "Dashboard" };

/** Dot colour per action-queue item kind (most urgent read as red/amber). */
const TODAY_DOT: Record<string, string> = {
  message: "bg-red-500",
  invoice: "bg-red-500",
  changes: "bg-amber-500",
  request: "bg-amber-500",
  proposal: "bg-amber-500",
  lead: "bg-amber-500",
  meeting: "bg-sky-500",
  approval: "bg-sky-500",
  retainer: "bg-emerald-500",
};

function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function AgingRow({
  label,
  bucket,
  tone,
}: {
  label: string;
  bucket: { amount: number; count: number };
  tone: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-medium ${bucket.amount > 0 ? tone : "text-muted-foreground"}`}>
        {usd.format(bucket.amount)}
        {bucket.count > 0 && (
          <span className="ml-1 text-xs text-muted-foreground">
            ({bucket.count})
          </span>
        )}
      </dd>
    </div>
  );
}

export default async function AdminDashboardPage() {
  await requireAdmin();
  const [data, pipeline, today, activity, health] = await Promise.all([
    getAdminDashboard(),
    getPipelineSummary(),
    getTodayItems(),
    listActivity({ take: 8 }),
    getBusinessHealth(),
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
                      TODAY_DOT[item.kind] ?? "bg-emerald-500"
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
          iconClassName="bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300"
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

      {/* Money: recurring revenue + what's owed, aged */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Repeat className="size-3.5" /> Monthly recurring (MRR)
            </p>
            <p className="mt-1 font-heading text-2xl font-bold">
              {usd.format(data.money.mrr)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              from active retainers
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <TrendingUp className="size-3.5" /> Expected next 30 days
            </p>
            <p className="mt-1 font-heading text-2xl font-bold">
              {usd.format(data.money.expectedNext30)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              invoices due soon + MRR
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CalendarClock className="size-3.5" /> Overdue, aged
            </p>
            <dl className="mt-2 space-y-1.5 text-sm">
              <AgingRow label="1–30 days" bucket={data.money.aging.current} tone="text-amber-600 dark:text-amber-300" />
              <AgingRow label="31–60 days" bucket={data.money.aging.thirty} tone="text-orange-600 dark:text-orange-300" />
              <AgingRow label="60+ days" bucket={data.money.aging.sixtyPlus} tone="text-red-600 dark:text-red-300" />
            </dl>
          </CardContent>
        </Card>
      </div>

      <BusinessHealthPanel health={health} />

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
                  <span className="ml-2 font-semibold text-red-600 dark:text-red-300">
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
                          className={`text-xs ${overdue ? "font-semibold text-red-600 dark:text-red-300" : "text-muted-foreground"}`}
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
            <ActivityFeed items={activity} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
