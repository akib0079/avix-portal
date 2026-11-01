import Link from "next/link";
import { notFound } from "next/navigation";
import { getMyInvoice } from "@/lib/dal/portal";
import { listActivePaymentAccounts, getPaymentGuideUrl } from "@/lib/dal/settings";
import { PaymentGuideButton } from "@/components/payments/payment-guide-button";
import { InvoiceStatusBadge } from "@/components/status-badges";
import { PaymentDetails } from "@/components/payments/payment-details";
import { formatCurrency } from "@/lib/currency";
import { ClaimPaymentButton } from "@/components/portal/claim-payment-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { balanceDue, creditedTotal } from "@/lib/invoice-totals";
import { isReceivable } from "@/lib/invoice-rules";
import { SoftPill } from "@/components/ui/status-pill";
import { HUE } from "@/lib/status-colors";
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

  const total = Number(invoice.amount);
  const credited = creditedTotal(invoice.creditNotes);
  const balance = balanceDue(total, Number(invoice.amountPaid), credited);
  // Only money still owed on a live invoice needs paying: not a paid or
  // cancelled one, and not a credit note (that is money owed to them).
  const payable = isReceivable(invoice) && balance > 0;

  // Both reads are cached across requests, so this costs no round trip.
  const [activeAccounts, guideUrl] = payable
    ? await Promise.all([listActivePaymentAccounts(), getPaymentGuideUrl()])
    : [[], null];
  // The account chosen for this invoice, when it has one: a EUR client was
  // being shown the US ACH details next to the SEPA ones. An invoice without
  // a choice (or whose account was retired) still lists every active one.
  const ownAccount = activeAccounts.find((a) => a.id === invoice.paymentAccountId);
  const paymentAccounts = ownAccount ? [ownAccount] : activeAccounts;

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
            {invoice.creditNoteForId ? (
              <SoftPill color={HUE.violet}>Credit note</SoftPill>
            ) : (
              <InvoiceStatusBadge status={invoice.status} />
            )}
          </div>

          {invoice.creditNoteFor ? (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Credited to you</p>
                <p className="font-heading text-xl font-bold">
                  {formatCurrency(total, invoice.currency)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Against</p>
                <Link
                  href={`/portal/invoices/${invoice.creditNoteFor.id}`}
                  className="font-medium hover:text-primary"
                >
                  {invoice.creditNoteFor.invoiceNumber}
                </Link>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Issued</p>
                <p className="font-medium">{formatDate(invoice.issueDate)}</p>
              </div>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">
                  {payable ? "Amount due" : "Invoice total"}
                </p>
                <p className="font-heading text-xl font-bold">
                  {formatCurrency(payable ? balance : total, invoice.currency)}
                </p>
                {payable && balance < total && (
                  <p className="text-xs text-muted-foreground">
                    of {formatCurrency(total, invoice.currency)}
                    {credited > 0 ? " after credits" : ""}
                    {Number(invoice.amountPaid) > 0 ? " and payments" : ""}
                  </p>
                )}
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
          )}

          {payable && (
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
            {guideUrl && (
              <div className="mt-5 border-t pt-4">
                <p className="mb-3 text-sm text-muted-foreground">
                  First time paying us, or transferring through Wise? The guide
                  walks through it step by step.
                </p>
                <PaymentGuideButton url={guideUrl} variant="subtle" />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
