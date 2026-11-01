import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoice, listInvoiceProjectOptions } from "@/lib/dal/invoices";
import { listActivePaymentAccounts } from "@/lib/dal/settings";
import { listActiveClientOptions } from "@/lib/dal/users";
import { PageHeader } from "@/components/page-header";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import {
  SendInvoiceButton,
  RemoveInvoiceButton,
} from "@/components/invoices/invoice-actions";
import { InvoiceStatusBadge } from "@/components/status-badges";
import { InvoicePayments } from "@/components/invoices/invoice-payments";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { Copy, Download, ExternalLink } from "lucide-react";
import { currencySymbol } from "@/lib/currency";
import { balanceDue, creditedTotal } from "@/lib/invoice-totals";
import { reminderSummary } from "@/lib/invoice-reminders";
import { serverNow } from "@/lib/server-now";
import { InvoiceReminders } from "@/components/invoices/invoice-reminders";
import { canDeleteInvoice, sendBlocker } from "@/lib/invoice-rules";
import { requireAdmin } from "@/lib/dal/session";

export const metadata = { title: "Invoice" };

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  // One wave: the projects are the invoice's client's (found through the
  // invoice itself, so they needn't wait for it), and the accounts are cached.
  const [invoice, clients, projects, paymentAccounts] = await Promise.all([
    getInvoice(id),
    listActiveClientOptions(),
    listInvoiceProjectOptions({ ofInvoice: id }),
    listActivePaymentAccounts(),
  ]);
  if (!invoice) notFound();

  const isCreditNote = !!invoice.creditNoteForId;
  const credited = creditedTotal(invoice.creditNotes);
  const balance = balanceDue(Number(invoice.amount), Number(invoice.amountPaid), credited);
  // Only an invoice that can still owe money has reminders to talk about.
  const showReminders =
    !isCreditNote && invoice.status !== "PAID" && invoice.status !== "CANCELLED" && balance > 0;
  const reminders = showReminders
    ? reminderSummary({ ...invoice, balance }, new Date(serverNow()), (d) => formatDate(d))
    : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={invoice.invoiceNumber}
        description={`${invoice.client.firstName} ${invoice.client.lastName} · issued ${formatDate(invoice.issueDate)}${invoice.sentAt ? ` · sent ${formatDate(invoice.sentAt)}` : ""}`}
      />
      {/* Its own wrapping row rather than the header's action slot, which
          doesn't wrap: five buttons overflowed a phone. */}
      <div className="-mt-5 mb-6 flex flex-wrap items-center gap-2">
        {invoice.paymentClaimedAt && invoice.status !== "PAID" && (
          <span className="rounded-full bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            Client says paid · {formatDate(invoice.paymentClaimedAt)}
          </span>
        )}
        <InvoiceStatusBadge status={invoice.status} />
        {invoice.status === "DRAFT" && (
          <span className="text-xs text-muted-foreground">Hidden from the client until sent</span>
        )}
        <span className="flex-1" />
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
        {!isCreditNote && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/invoices/new?from=${invoice.id}`}>
              <Copy /> Duplicate
            </Link>
          </Button>
        )}
        {!sendBlocker(invoice) && (
          <SendInvoiceButton
            invoiceId={invoice.id}
            clientEmail={invoice.client.email}
            sent={!!invoice.sentAt}
          />
        )}
        <RemoveInvoiceButton
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoiceNumber}
          cancelled={invoice.status === "CANCELLED"}
          deletable={canDeleteInvoice({
            status: invoice.status,
            sentAt: invoice.sentAt,
            paymentClaimedAt: invoice.paymentClaimedAt,
            amountPaid: Number(invoice.amountPaid),
            paymentCount: invoice.payments.length,
            creditNoteCount: invoice.creditNotes.length,
          })}
        />
      </div>

      {/* Money first: what's owed is the question you open an invoice with. */}
      <div className="mb-6">
        <InvoicePayments
          invoice={{
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            currency: invoice.currency,
            status: invoice.status,
            creditNoteForId: invoice.creditNoteForId,
          }}
          total={Number(invoice.amount)}
          amountPaid={Number(invoice.amountPaid)}
          credited={credited}
          currencySymbol={currencySymbol(invoice.currency)}
          payments={invoice.payments.map((p) => ({
            id: p.id,
            amount: Number(p.amount),
            paidAt: p.paidAt.toISOString(),
            method: p.method,
            note: p.note,
          }))}
        />
        {reminders && (
          <div className="mt-3">
            <InvoiceReminders
              invoiceId={invoice.id}
              paused={invoice.remindersPaused}
              summary={reminders}
            />
          </div>
        )}
        {invoice.creditNotes.length > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            Credited by{" "}
            {invoice.creditNotes.map((note, i) => (
              <span key={note.id}>
                {i > 0 && ", "}
                <Link href={`/admin/invoices/${note.id}`} className="hover:text-primary">
                  {note.invoiceNumber}
                </Link>
              </span>
            ))}
          </p>
        )}
        {invoice.duplicatedFrom && (
          <p className="mt-2 text-sm text-muted-foreground">
            Copied from{" "}
            <Link
              href={`/admin/invoices/${invoice.duplicatedFrom.id}`}
              className="hover:text-primary"
            >
              {invoice.duplicatedFrom.invoiceNumber}
            </Link>
          </p>
        )}
        {invoice.creditNoteFor && (
          <p className="mt-2 text-sm text-muted-foreground">
            Credit note against{" "}
            <Link
              href={`/admin/invoices/${invoice.creditNoteFor.id}`}
              className="hover:text-primary"
            >
              {invoice.creditNoteFor.invoiceNumber}
            </Link>
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Edit invoice</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceForm
            clients={clients}
            projects={projects}
            paymentAccounts={paymentAccounts.map((a) => ({ id: a.id, title: a.title }))}
            invoice={{
              id: invoice.id,
              clientId: invoice.clientId,
              projectId: invoice.projectId ?? "none",
              amount: Number(invoice.amount),
              discount: Number(invoice.discount ?? 0),
              taxRate: invoice.taxRate == null ? null : Number(invoice.taxRate),
              taxLabel: invoice.taxLabel ?? "",
              paymentTermsDays: invoice.paymentTermsDays ?? null,
              status: invoice.status,
              issueDate: invoice.issueDate.toISOString().slice(0, 10),
              dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? "",
              notes: invoice.notes ?? "",
              payLinkUrl: invoice.payLinkUrl ?? "",
              pdfExternalUrl: invoice.pdfExternalUrl ?? "",
              pdfOriginalName: invoice.pdfOriginalName,
              invoiceNumber: invoice.invoiceNumber,
              title: invoice.title ?? "",
              currency: invoice.currency,
              // Without it every save of a EUR or GBP invoice wiped the USD
              // value the owner had entered.
              amountUsd: invoice.amountUsd == null ? null : Number(invoice.amountUsd),
              paymentAccountId: invoice.paymentAccountId ?? "none",
              billToCompany: invoice.billToCompany ?? "",
              billToAddress: invoice.billToAddress ?? "",
              billToEmail: invoice.billToEmail ?? "",
              items: invoice.items.map((i) => ({
                description: i.description,
                // The editor's own document. Leaving it out made the editor
                // rebuild one from the plain text, losing bold, italics and
                // nesting, and the next save stored that lossy copy.
                descriptionRich: i.descriptionRich ?? null,
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
