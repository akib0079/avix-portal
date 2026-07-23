import { listActiveClientOptions } from "@/lib/dal/users";
import { requireAdmin } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "New Invoice" };

export default async function NewInvoicePage() {
  await requireAdmin();
  const [clients, projects, paymentAccounts] = await Promise.all([
    listActiveClientOptions(),
    prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, projectName: true, clientId: true },
    }),
    prisma.paymentAccount.findMany({
      where: { isActive: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New Invoice"
        description="The invoice number is assigned automatically."
      />
      <Card>
        <CardContent className="pt-6">
          <InvoiceForm
            clients={clients}
            projects={projects}
            paymentAccounts={paymentAccounts}
          />
        </CardContent>
      </Card>
    </div>
  );
}
