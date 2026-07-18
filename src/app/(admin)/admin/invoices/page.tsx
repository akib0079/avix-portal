import Link from "next/link";
import { listInvoices } from "@/lib/dal/invoices";
import { PageHeader } from "@/components/page-header";
import {
  InvoiceStatusSelect,
  DeleteInvoiceButton,
} from "@/components/invoices/invoice-actions";
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
import { usd, formatDate } from "@/lib/format";
import { Plus, FileText, Paperclip } from "lucide-react";
import { requireAdmin } from "@/lib/dal/session";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  await requireAdmin();
  const invoices = await listInvoices();

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

      <Card>
        <CardContent>
          {invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <FileText className="size-6 text-muted-foreground" />
              </div>
              <p className="mt-4 font-medium">No invoices yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your first invoice to start billing.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="hidden md:table-cell">Client</TableHead>
                  <TableHead className="hidden lg:table-cell">Project</TableHead>
                  <TableHead className="hidden sm:table-cell">Issued</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>
                      <Link
                        href={`/admin/invoices/${invoice.id}`}
                        className="flex items-center gap-1.5 font-medium hover:text-primary"
                      >
                        {invoice.invoiceNumber}
                        {(invoice.pdfPath || invoice.pdfExternalUrl) && (
                          <Paperclip className="size-3 text-muted-foreground" />
                        )}
                        {invoice.paymentClaimedAt && invoice.status !== "PAID" && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            Client says paid
                          </span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {invoice.client.firstName} {invoice.client.lastName}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {invoice.project?.projectName ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {formatDate(invoice.issueDate)}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {usd.format(Number(invoice.amount))}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusSelect
                        invoiceId={invoice.id}
                        status={invoice.status}
                      />
                    </TableCell>
                    <TableCell>
                      <DeleteInvoiceButton
                        invoiceId={invoice.id}
                        invoiceNumber={invoice.invoiceNumber}
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
