import Link from "next/link";
import { listClients } from "@/lib/dal/users";
import { PageHeader } from "@/components/page-header";
import { ClientsView } from "@/components/clients/clients-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Building2 } from "lucide-react";
import { requireAdmin } from "@/lib/dal/session";
import { serverNow } from "@/lib/server-now";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  await requireAdmin();
  const clients = await listClients();
  const now = serverNow();

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Who owes, who has gone quiet, who hasn't signed in yet."
        action={
          <Button asChild>
            <Link href="/admin/clients/new">
              <Plus /> Add Client
            </Link>
          </Button>
        }
      />

      {clients.length === 0 ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Building2 className="size-6 text-muted-foreground" />
              </div>
              <p className="mt-4 font-medium">No clients yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add your first client to get started.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ClientsView
          clients={clients.map((c) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            company: c.company,
            phone: c.phone,
            status: c.status,
            emailVerified: c.emailVerified,
            projects: c._count.projects,
            liveProjects: c.liveProjects,
            health: c.health,
            healthReason: c.healthReason,
            owedUsd: c.owedUsd,
            owedUnconverted: c.owedUnconverted,
            lastContactDays: c.lastContactAt
              ? Math.max(0, Math.floor((now - c.lastContactAt.getTime()) / 86_400_000))
              : null,
          }))}
        />
      )}
    </div>
  );
}
