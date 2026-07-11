import Link from "next/link";
import { getAdminDashboard } from "@/lib/dal/dashboard";
import { getPipelineSummary } from "@/lib/dal/leads";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { InvoiceStatusDonut } from "@/components/dashboard/invoice-status-donut";
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
import { usd, projectTypeLabels } from "@/lib/format";
import { Users, FolderKanban, FileText, DollarSign } from "lucide-react";

export const metadata = { title: "Dashboard" };

export default async function AdminDashboardPage() {
  const [data, pipeline] = await Promise.all([
    getAdminDashboard(),
    getPipelineSummary(),
  ]);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Your agency overview at a glance."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Clients"
          value={String(data.totalClients)}
          icon={<Users className="size-5" />}
          iconClassName="bg-info-tint text-info"
        />
        <StatCard
          label="Total Projects"
          value={String(data.totalProjects)}
          icon={<FolderKanban className="size-5" />}
          iconClassName="bg-brand-tint text-primary"
        />
        <StatCard
          label="Total Invoices"
          value={String(data.totalInvoices)}
          icon={<FileText className="size-5" />}
          iconClassName="bg-violet-50 text-violet-600"
        />
        <StatCard
          label="Paid Revenue"
          value={usd.format(data.paidRevenue)}
          icon={<DollarSign className="size-5" />}
          iconClassName="bg-success-tint text-success"
        />
      </div>

      {pipeline.open > 0 && (
        <Link
          href="/admin/leads"
          className="mt-4 flex items-center justify-between rounded-xl border bg-card px-5 py-3.5 transition-colors hover:bg-muted/50"
        >
          <span className="text-sm">
            <span className="font-semibold">{pipeline.open}</span> open lead
            {pipeline.open === 1 ? "" : "s"} in the pipeline
            {pipeline.overdue > 0 && (
              <span className="ml-2 font-semibold text-red-600">
                · {pipeline.overdue} follow-up{pipeline.overdue === 1 ? "" : "s"} overdue
              </span>
            )}
          </span>
          <span className="text-sm font-medium text-primary">View pipeline →</span>
        </Link>
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
    </div>
  );
}
