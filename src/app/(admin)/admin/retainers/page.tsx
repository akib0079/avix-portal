import { listRetainers } from "@/lib/dal/retainers";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/dal/session";
import { PageHeader } from "@/components/page-header";
import { RetainerManager } from "@/components/retainers/retainer-manager";
import { serverNow } from "@/lib/server-now";

export const metadata = { title: "Retainers" };

export default async function RetainersPage() {
  await requireAdmin();
  const [retainers, clients, projects] = await Promise.all([
    listRetainers(),
    prisma.user.findMany({
      where: { role: "CLIENT", status: "ACTIVE" },
      orderBy: { firstName: "asc" },
      select: { id: true, firstName: true, lastName: true, company: true },
    }),
    prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, projectName: true, clientId: true },
    }),
  ]);

  // The billing month as the drafting job reads it: server time, "YYYY-MM".
  const now = new Date(serverNow());
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div>
      <PageHeader
        title="Retainers"
        description="Monthly plans — invoices draft themselves, you review and send."
      />
      <RetainerManager
        retainers={retainers}
        clients={clients}
        projects={projects}
        period={period}
        today={now.getDate()}
      />
    </div>
  );
}
