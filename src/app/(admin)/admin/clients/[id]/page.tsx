import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient } from "@/lib/dal/users";
import { PageHeader } from "@/components/page-header";
import { ClientForm } from "@/components/clients/client-form";
import { ClientActions } from "@/components/clients/client-actions";
import {
  UserStatusBadge,
  InviteBadge,
  ProjectStatusBadge,
  InvoiceStatusBadge,
} from "@/components/status-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usd, formatDate, projectTypeLabels } from "@/lib/format";
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

  return (
    <div>
      <PageHeader
        title={`${client.firstName} ${client.lastName}`}
        description={client.company ?? client.email}
        action={
          <div className="flex items-center gap-2">
            <UserStatusBadge status={client.status} />
            <InviteBadge emailVerified={client.emailVerified} />
            <ClientActions
              client={{
                id: client.id,
                name: `${client.firstName} ${client.lastName}`,
                status: client.status,
                emailVerified: client.emailVerified,
              }}
            />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="font-heading text-lg">Details</CardTitle>
          </CardHeader>
          <CardContent>
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

        <div className="space-y-6 xl:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading text-lg">
                Projects ({client.projects.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {client.projects.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
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

          <Card>
            <CardHeader>
              <CardTitle className="font-heading text-lg">
                Invoices ({client.invoices.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {client.invoices.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No invoices for this client yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead className="hidden sm:table-cell">Issued</TableHead>
                      <TableHead>Amount</TableHead>
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
        </div>
      </div>
    </div>
  );
}
