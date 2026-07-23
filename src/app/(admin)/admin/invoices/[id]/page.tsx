import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoice } from "@/lib/dal/invoices";
import { listActiveClientOptions } from "@/lib/dal/users";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import {
  SendInvoiceButton,
  DeleteInvoiceButton,
} from "@/components/invoices/invoice-actions";
import { InvoiceStatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { Download, ExternalLink } from "lucide-react";
import { requireAdmin } from "@/lib/dal/session";

export const metadata = { title: "Invoice" };

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const [invoice, clients, projects, paymentAccounts] = await Promise.all([
    getInvoice(id),
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
  if (!invoice) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={invoice.invoiceNumber}
        description={`${invoice.client.firstName} ${invoice.client.lastName} · issued ${formatDate(invoice.issueDate)}${invoice.sentAt ? ` · sent ${formatDate(invoice.sentAt)}` : ""}`}
        action={
          <div className="flex items-center gap-2">
            {invoice.paymentClaimedAt && invoice.status !== "PAID" && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                Client says paid · {formatDate(invoice.paymentClaimedAt)}
              </span>
            )}
            <InvoiceStatusBadge status={invoice.status} />
            {invoice.pdfExternalUrl || invoice.pdfPath ? (
              /* An admin-supplied document (link or upload) takes precedence. */
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/api/files/invoice/${invoice.id}`}
                  prefetch={false}
                  target={invoice.pdfExternalUrl ? "_blank" : undefined}
                >
                  {invoice.pdfExternalUrl ? (
                    <>
                      <ExternalLink /> View PDF
                    </>
                  ) : (
                    <>
                      <Download /> PDF
                    </>
                  )}
                </Link>
              </Button>
            ) : (
              /* No supplied file → the generated document. */
              <Button asChild variant="outline" size="sm">
                <Link href={`/api/invoices/${invoice.id}/pdf`} prefetch={false} target="_blank">
                  <Download /> Download PDF
                </Link>
              </Button>
            )}
            <SendInvoiceButton
              invoiceId={invoice.id}
              clientEmail={invoice.client.email}
            />
            <DeleteInvoiceButton
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoiceNumber}
              redirectAfterDelete="/admin/invoices"
            />
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Edit invoice</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceForm
            clients={clients}
            projects={projects}
            paymentAccounts={paymentAccounts}
            invoice={{
              id: invoice.id,
              clientId: invoice.clientId,
              projectId: invoice.projectId ?? "none",
              amount: Number(invoice.amount),
              status: invoice.status,
              issueDate: invoice.issueDate.toISOString().slice(0, 10),
              dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? "",
              notes: invoice.notes ?? "",
              pdfExternalUrl: invoice.pdfExternalUrl ?? "",
              pdfOriginalName: invoice.pdfOriginalName,
              title: invoice.title ?? "",
              currency: invoice.currency,
              paymentAccountId: invoice.paymentAccountId ?? "none",
              items: invoice.items.map((i) => ({
                description: i.description,
                qty: Number(i.qty),
                rate: Number(i.rate),
              })),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
