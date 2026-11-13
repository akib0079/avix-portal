import Link from "next/link";
import { listActiveClientOptions } from "@/lib/dal/users";
import { requireAdmin } from "@/lib/dal/session";
import { getInvoiceCopySource, listInvoiceProjectOptions } from "@/lib/dal/invoices";
import { listActivePaymentAccounts } from "@/lib/dal/settings";
import { getBookingConfig } from "@/lib/dal/availability";
import { invoiceCopyDefaults, todayIn } from "@/lib/invoice-copy";
import { PageHeader } from "@/components/page-header";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import { Card, CardContent } from "@/components/ui/card";
import { Copy } from "lucide-react";

export const metadata = { title: "New Invoice" };

/**
 * A blank invoice, a duplicate (?from=<invoice id>) or one for a client
 * (?client=<client id>). A duplicate is a prefilled form in create mode:
 * nothing is written, and no number is used, until it is saved.
 */
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; client?: string }>;
}) {
  await requireAdmin();
  const { from, client } = await searchParams;

  // One wave. The projects come for the client being invoiced (found through
  // the source invoice for a copy), not for every client in the system.
  const [clients, paymentAccounts, source, booking, projects] = await Promise.all([
    listActiveClientOptions(),
    listActivePaymentAccounts(),
    from ? getInvoiceCopySource(from) : null,
    // The agency's today: a copy's dates, and the earliest a new invoice can repeat.
    getBookingConfig(),
    from
      ? listInvoiceProjectOptions({ ofInvoice: from })
      : client
        ? listInvoiceProjectOptions({ clientId: client })
        : [],
  ]);

  // Today in the agency's zone: the server runs on UTC, the agency doesn't.
  const today = todayIn(booking.agencyTimezone);
  const copy = source ? invoiceCopyDefaults(source, { today }) : null;
  // A copy for a client who has since been deactivated waits for the owner to
  // pick who it is for, rather than quietly billing an inactive account, and
  // doesn't carry that client's billed-to details to whoever is picked.
  const clientGone = !!copy?.ok && !clients.some((c) => c.id === copy.input.clientId);
  const initial = copy?.ok
    ? clientGone
      ? {
          ...copy.input,
          clientId: "",
          projectId: "none",
          billToCompany: "",
          billToAddress: "",
          billToEmail: "",
        }
      : copy.input
    : client && clients.some((c) => c.id === client)
      ? { clientId: client }
      : undefined;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New Invoice"
        description={
          copy?.ok && source
            ? `Copied from ${source.invoiceNumber}. It starts as a draft the client can't see; check the dates and lines, then save.`
            : "The invoice number is assigned automatically."
        }
      />
      {copy?.ok && source && (
        <p className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Copy className="size-3.5" />
          Copied from{" "}
          <Link href={`/admin/invoices/${source.id}`} className="font-medium hover:text-primary">
            {source.invoiceNumber}
          </Link>
          · new number, today&apos;s date, nothing paid
        </p>
      )}
      {clientGone && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          The client on {source?.invoiceNumber} is no longer active. Pick who this copy is for.
        </p>
      )}
      {from && !copy?.ok && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          {copy && !copy.ok ? copy.error : "That invoice no longer exists."} Starting from a
          blank invoice instead.
        </p>
      )}
      <Card>
        <CardContent className="pt-6">
          <InvoiceForm
            // Remount per source, so moving between copies resets the fields.
            key={from ?? client ?? "blank"}
            clients={clients}
            projects={projects}
            paymentAccounts={paymentAccounts.map((a) => ({ id: a.id, title: a.title }))}
            initial={initial}
            today={today}
            copiedFrom={
              copy?.ok && source
                ? { invoiceNumber: source.invoiceNumber, lastAmountUsd: copy.lastAmountUsd }
                : undefined
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
