import Link from "next/link";
import { listClients } from "@/lib/dal/users";
import { PageHeader } from "@/components/page-header";
import { ClientActions } from "@/components/clients/client-actions";
import { UserStatusBadge, InviteBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Building2 } from "lucide-react";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const clients = await listClients();

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Manage your client accounts."
        action={
          <Button asChild>
            <Link href="/admin/clients/new">
              <Plus /> Add Client
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent>
          {clients.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Building2 className="size-6 text-muted-foreground" />
              </div>
              <p className="mt-4 font-medium">No clients yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add your first client to get started.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="hidden md:table-cell">Company</TableHead>
                  <TableHead className="hidden md:table-cell">Phone</TableHead>
                  <TableHead className="hidden sm:table-cell">Projects</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell>
                      <Link
                        href={`/admin/clients/${client.id}`}
                        className="flex items-center gap-2 font-medium hover:text-primary"
                      >
                        <span
                          className={`size-2 shrink-0 rounded-full ${
                            client.health === "red"
                              ? "bg-red-500"
                              : client.health === "amber"
                                ? "bg-amber-400"
                                : "bg-emerald-500"
                          }`}
                          title={
                            client.health === "red"
                              ? "Invoice 7+ days overdue"
                              : client.health === "amber"
                                ? "Overdue invoice or gone quiet"
                                : "All good"
                          }
                        />
                        {client.firstName} {client.lastName}
                      </Link>
                      <p className="pl-4 text-xs text-muted-foreground">{client.email}</p>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {client.company ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {client.phone ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">
                      {client._count.projects}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <UserStatusBadge status={client.status} />
                        <InviteBadge emailVerified={client.emailVerified} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <ClientActions
                        client={{
                          id: client.id,
                          name: `${client.firstName} ${client.lastName}`,
                          status: client.status,
                          emailVerified: client.emailVerified,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
