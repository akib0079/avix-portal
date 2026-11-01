import Link from "next/link";
import { listInvoices } from "@/lib/dal/invoices";
import { PageHeader } from "@/components/page-header";
import { InvoiceTable } from "@/components/invoices/invoice-table";
import { INVOICE_FILTERS } from "@/components/invoices/invoice-row";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { serverNow } from "@/lib/server-now";
import { requireAdmin } from "@/lib/dal/session";
import { creditedTotal } from "@/lib/invoice-totals";
import { canDeleteInvoice } from "@/lib/invoice-rules";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireAdmin();
  const [invoices, { filter }] = await Promise.all([listInvoices(), searchParams]);
  const initialFilter = INVOICE_FILTERS.find((f) => f.value === filter)?.value ?? "all";
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
        initialFilter={initialFilter}
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
          credited: creditedTotal(invoice.creditNotes),
          currency: invoice.currency,
          amountUsd: invoice.amountUsd === null ? null : Number(invoice.amountUsd),
          status: invoice.status,
          creditNoteForId: invoice.creditNoteForId,
          hasDocument: !!(invoice.pdfPath || invoice.pdfExternalUrl),
          suppliedLink: !!invoice.pdfExternalUrl,
          paymentClaimed: !!invoice.paymentClaimedAt,
          sent: !!invoice.sentAt,
          deletable: canDeleteInvoice({
            status: invoice.status,
            sentAt: invoice.sentAt,
            paymentClaimedAt: invoice.paymentClaimedAt,
            amountPaid: Number(invoice.amountPaid),
            paymentCount: invoice._count.payments,
            creditNoteCount: invoice.creditNotes.length,
          }),
        }))}
      />
    </div>
  );
}
