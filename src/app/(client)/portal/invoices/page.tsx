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
import { Download, FileText } from "lucide-react";

export const metadata = { title: "Invoices" };

export default async function MyInvoicesPage() {
  const invoices = await listMyInvoices();

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Your billing history with Avix Digital."
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
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
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
                      {invoice.pdfPath && (
                        <Button asChild variant="ghost" size="icon" className="size-8">
                          <Link href={`/api/files/invoice/${invoice.id}`} prefetch={false}>
                            <Download className="size-4" />
                            <span className="sr-only">Download PDF</span>
                          </Link>
                        </Button>
                      )}
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
