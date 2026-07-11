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

export const metadata = { title: "Invoice" };

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [invoice, clients, projects] = await Promise.all([
    getInvoice(id),
    listActiveClientOptions(),
    prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, projectName: true, clientId: true },
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
            <InvoiceStatusBadge status={invoice.status} />
            {(invoice.pdfPath || invoice.pdfExternalUrl) && (
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
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
