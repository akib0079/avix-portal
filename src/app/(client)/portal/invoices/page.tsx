import Link from "next/link";
import { listMyInvoices } from "@/lib/dal/portal";
import { PageHeader } from "@/components/page-header";
import { InvoiceStatusBadge } from "@/components/status-badges";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usd, formatDate } from "@/lib/format";
import { Download, FileText, ChevronRight } from "lucide-react";

export const metadata = { title: "Invoices" };

export default async function MyInvoicesPage() {
  const invoices = await listMyInvoices();
  const outstanding = invoices
    .filter((i) => i.status !== "PAID")
    .reduce((sum, i) => sum + Number(i.amount), 0);
  const paid = invoices
    .filter((i) => i.status === "PAID")
    .reduce((sum, i) => sum + Number(i.amount), 0);

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Your billing history with Avix Digital."
      />

      {invoices.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-5">
            <p className="text-sm text-muted-foreground">Outstanding</p>
            <p className="font-heading mt-1 text-2xl font-bold text-primary">
              {usd.format(outstanding)}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <p className="text-sm text-muted-foreground">Paid to date</p>
            <p className="font-heading mt-1 text-2xl font-bold text-success">
              {usd.format(paid)}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <p className="text-sm text-muted-foreground">Invoices</p>
            <p className="font-heading mt-1 text-2xl font-bold">{invoices.length}</p>
          </div>
        </div>
      )}

      <Card>
        <CardContent>
          {invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <FileText className="size-6 text-muted-foreground" />
              </div>
              <p className="mt-4 font-medium">No invoices yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Invoices appear here when they&apos;re issued.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="hidden md:table-cell">Project</TableHead>
                  <TableHead className="hidden sm:table-cell">Issued</TableHead>
                  <TableHead className="hidden lg:table-cell">Due</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow
                    key={invoice.id}
                    className="group relative cursor-pointer transition-colors hover:bg-muted/50"
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/portal/invoices/${invoice.id}`}
                        className="block after:absolute after:inset-0"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {invoice.project?.projectName ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {formatDate(invoice.issueDate)}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {formatDate(invoice.dueDate)}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {usd.format(Number(invoice.amount))}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={invoice.status} />
                    </TableCell>
                    <TableCell>
                      <div className="relative z-10 flex items-center justify-end gap-1">
                        {invoice.pdfPath && (
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            className="size-8"
                          >
                            <Link
                              href={`/api/files/invoice/${invoice.id}`}
                              prefetch={false}
                            >
                              <Download className="size-4" />
                              <span className="sr-only">Download PDF</span>
                            </Link>
                          </Button>
                        )}
                        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </div>
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
