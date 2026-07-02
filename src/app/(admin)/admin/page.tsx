import Link from "next/link";
import { getAdminDashboard } from "@/lib/dal/dashboard";
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
  const data = await getAdminDashboard();

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
