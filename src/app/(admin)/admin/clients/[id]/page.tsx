import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient, getClientSnapshot } from "@/lib/dal/users";
import { listActivity } from "@/lib/dal/activity";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { ClientForm } from "@/components/clients/client-form";
import { ClientActions } from "@/components/clients/client-actions";
import { ClientRail } from "@/components/clients/client-rail";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { ProjectStatusBadge, InvoiceStatusBadge } from "@/components/status-badges";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { usd, formatDate, projectTypeLabels } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrowLeft, Inbox } from "lucide-react";
import { requireAdmin } from "@/lib/dal/session";

export const metadata = { title: "Client" };

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();

  const [snapshot, activity, requests] = await Promise.all([
    getClientSnapshot(id),
    listActivity({ clientId: id, take: 20 }),
    prisma.taskRequest.findMany({
      where: { clientId: id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        project: { select: { id: true, projectName: true } },
      },
    }),
  ]);

  const openRequests = requests.filter((r) => r.status === "PENDING").length;
  const unpaidInvoices = client.invoices.filter(
    (i) => i.status !== "PAID" && i.status !== "CANCELLED",
  ).length;

  const tabs = [
    {
      value: "projects",
      label: "Projects",
      count: client.projects.length,
      content: (
        <Card>
          <CardContent className="pt-6">
            {client.projects.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No projects for this client yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="hidden sm:table-cell">Type</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {client.projects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell>
                        <Link
                          href={`/admin/projects/${project.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {project.projectName}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                        {projectTypeLabels[project.type]}
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
      ),
    },
    {
      value: "invoices",
      label: "Invoices",
      count: client.invoices.length,
      alert: unpaidInvoices > 0,
      content: (
        <Card>
          <CardContent className="pt-6">
            {client.invoices.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No invoices for this client yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead className="hidden sm:table-cell">Issued</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead className="hidden sm:table-cell">Paid</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {client.invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <Link
                          href={`/admin/invoices/${invoice.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {invoice.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                        {formatDate(invoice.issueDate)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {usd.format(Number(invoice.amount))}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                        {usd.format(Number(invoice.amountPaid))}
                      </TableCell>
                      <TableCell>
                        <InvoiceStatusBadge status={invoice.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ),
    },
    {
      value: "requests",
      label: "Requests",
      count: requests.length,
      alert: openRequests > 0,
      content: (
        <Card>
          <CardContent className="pt-6">
            {requests.length === 0 ? (
              <p className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                <Inbox className="size-5" />
                Nothing requested from the portal yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {requests.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <span className="min-w-0">
                      <Link
                        href="/admin/task-requests"
                        className="block truncate text-sm font-medium hover:text-primary"
                      >
                        {r.title}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(r.createdAt)}
                        {r.project ? ` · ${r.project.projectName}` : ""}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        r.status === "PENDING"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ),
    },
    {
      value: "details",
      label: "Details",
      content: (
        <Card>
          <CardContent className="pt-6">
            <ClientForm
              client={{
                id: client.id,
                firstName: client.firstName,
                lastName: client.lastName,
                email: client.email,
                company: client.company ?? "",
                phone: client.phone ?? "",
                timezone: client.timezone ?? "",
              }}
            />
          </CardContent>
        </Card>
      ),
    },
    {
      value: "activity",
      label: "Activity",
      content: (
        <Card>
          <CardContent className="pt-6">
            <ActivityFeed
              items={activity}
              emptyLabel="No recorded activity for this client yet."
            />
          </CardContent>
        </Card>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/admin/clients"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to Clients
        </Link>
        <ClientActions
          client={{
            id: client.id,
            name: `${client.firstName} ${client.lastName}`,
            status: client.status,
            emailVerified: client.emailVerified,
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_1fr]">
        {/* Context rail — who they are and what they're worth, always visible. */}
        <div className="xl:sticky xl:top-16 xl:self-start">
          <ClientRail
            client={{
              id: client.id,
              firstName: client.firstName,
              lastName: client.lastName,
              email: client.email,
              company: client.company,
              phone: client.phone,
              timezone: client.timezone,
              status: client.status,
              emailVerified: client.emailVerified,
            }}
            snapshot={snapshot}
          />
        </div>

        <div className="min-w-0">
          <ProjectTabs tabs={tabs} defaultTab="projects" />
        </div>
      </div>
    </div>
  );
}
