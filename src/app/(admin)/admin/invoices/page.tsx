import Link from "next/link";
import { listInvoices } from "@/lib/dal/invoices";
import { PageHeader } from "@/components/page-header";
import { InvoiceTable } from "@/components/invoices/invoice-table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { serverNow } from "@/lib/server-now";
import { requireAdmin } from "@/lib/dal/session";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  await requireAdmin();
  const invoices = await listInvoices();
  // Server-rendered timestamp keeps the aging buckets stable across renders.
  const renderedAt = serverNow();

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Create, send, and track client invoices."
        action={
          <Button asChild>
            <Link href="/admin/invoices/new">
              <Plus /> New Invoice
            </Link>
          </Button>
        }
      />

      <InvoiceTable
        now={renderedAt}
        invoices={invoices.map((invoice) => ({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          clientId: invoice.client.id,
          clientName:
            `${invoice.client.firstName} ${invoice.client.lastName}`.trim() ||
            (invoice.client.company ?? "Client"),
          projectName: invoice.project?.projectName ?? null,
          issueDate: invoice.issueDate.toISOString(),
          dueDate: invoice.dueDate?.toISOString() ?? null,
          amount: Number(invoice.amount),
          amountPaid: Number(invoice.amountPaid),
          status: invoice.status,
          hasDocument: !!(invoice.pdfPath || invoice.pdfExternalUrl),
          paymentClaimed: !!invoice.paymentClaimedAt,
        }))}
      />
    </div>
  );
}
