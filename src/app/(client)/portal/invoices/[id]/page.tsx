import Link from "next/link";
import { notFound } from "next/navigation";
import { getMyInvoice } from "@/lib/dal/portal";
import { listActivePaymentAccounts } from "@/lib/dal/settings";
import { InvoiceStatusBadge } from "@/components/status-badges";
import { PaymentDetails } from "@/components/payments/payment-details";
import { ClaimPaymentButton } from "@/components/portal/claim-payment-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usd, formatDate } from "@/lib/format";
import { ArrowLeft, Download, Receipt, ExternalLink } from "lucide-react";

export const metadata = { title: "Invoice" };

export default async function ClientInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await getMyInvoice(id);
  if (!invoice) notFound();

  const paymentAccounts =
    invoice.status === "PAID" ? [] : await listActivePaymentAccounts();

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/portal/invoices"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to Invoices
      </Link>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-brand-tint text-primary">
                <Receipt className="size-5" />
              </div>
              <div>
                <h1 className="font-heading text-2xl font-bold">
                  {invoice.invoiceNumber}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {invoice.project?.projectName ?? "General"} · issued{" "}
                  {formatDate(invoice.issueDate)}
                </p>
              </div>
            </div>
            <InvoiceStatusBadge status={invoice.status} />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Amount due</p>
              <p className="font-heading text-xl font-bold">
                {usd.format(Number(invoice.amount))}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Issued</p>
              <p className="font-medium">{formatDate(invoice.issueDate)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Due</p>
              <p className="font-medium">{formatDate(invoice.dueDate)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <div className="mt-0.5">
                <InvoiceStatusBadge status={invoice.status} />
              </div>
            </div>
          </div>

          {invoice.status !== "PAID" && (
            <div className="mt-6">
              <ClaimPaymentButton
                invoiceId={invoice.id}
                claimed={!!invoice.paymentClaimedAt}
              />
            </div>
          )}

          <div className="mt-6">
            {invoice.pdfExternalUrl || invoice.pdfPath ? (
              <Button asChild>
                <Link
                  href={`/api/files/invoice/${invoice.id}`}
                  prefetch={false}
                  target={invoice.pdfExternalUrl ? "_blank" : undefined}
                >
                  {invoice.pdfExternalUrl ? (
                    <>
                      <ExternalLink /> View invoice
                    </>
                  ) : (
                    <>
                      <Download /> Download the invoice
                    </>
                  )}
                </Link>
              </Button>
            ) : (
              /* No supplied file → the generated PDF, always available. */
              <Button asChild>
                <Link href={`/api/invoices/${invoice.id}/pdf`} prefetch={false} target="_blank">
                  <Download /> Download the invoice
                </Link>
              </Button>
            )}
          </div>

          {invoice.notes && (
            <div className="mt-6 border-t pt-4">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Notes</p>
              <p className="text-sm whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {paymentAccounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">How to pay</CardTitle>
            <p className="text-sm text-muted-foreground">
              Pay by bank transfer using the details below. Tap any value to
              copy it, and reference{" "}
              <span className="font-medium text-foreground">
                {invoice.invoiceNumber}
              </span>{" "}
              in your transfer.
            </p>
          </CardHeader>
          <CardContent>
            <PaymentDetails accounts={paymentAccounts} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
