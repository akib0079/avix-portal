import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/resend";
import InvoiceSentEmail from "@/emails/invoice-sent";
import { invoicePdfInclude, renderInvoicePdfFor } from "@/lib/pdf/invoice-render";
import { logActivity } from "@/lib/dal/activity";
import { formatCurrency } from "@/lib/currency";
import { appUrl } from "@/lib/app-url";
import { sendBlocker } from "@/lib/invoice-rules";
import { isSecureLink } from "@/lib/validation/invoice";

export type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Emails an invoice to its client and marks it sent.
 *
 * NO AUTHORIZATION HERE: the caller decides who may send. sendInvoice (the
 * admin's button) checks requireAdmin first; a recurring plan's duty sends the
 * drafts it made itself. This lives outside the "use server" actions file on
 * purpose, because every export of that file is callable from a browser.
 *
 * One read loads the invoice with everything the email and the PDF need,
 * including its own payment account, and the PDF renders from that row. The
 * client's notification and the activity entry run after the response, so a
 * caller must be inside a request: a server action, a route handler, or an
 * after() task (the duties engine runs in one).
 */
export async function sendInvoiceCore(id: string): Promise<SendResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      ...invoicePdfInclude,
      client: {
        select: { id: true, firstName: true, lastName: true, company: true, email: true },
      },
      project: { select: { projectName: true } },
    },
  });
  if (!invoice) return { ok: false, error: "Invoice not found." };
  const blocked = sendBlocker(invoice);
  if (blocked) return { ok: false, error: blocked };

  // Attach the generated PDF unless the admin supplied their own document
  // (an uploaded file or an external link the client opens directly).
  const attachments =
    !invoice.pdfPath && !invoice.pdfExternalUrl
      ? [
          {
            filename: `${invoice.invoiceNumber}.pdf`,
            content: await renderInvoicePdfFor(invoice),
          },
        ]
      : undefined;

  // Only the account chosen for this invoice, and only while it is still in
  // use; the portal page lists the current ones either way.
  const account = invoice.paymentAccount?.isActive ? invoice.paymentAccount : null;
  const amount = formatCurrency(Number(invoice.amount), invoice.currency);
  const sent = await sendEmail({
    to: invoice.client.email,
    subject: `Invoice ${invoice.invoiceNumber} from Avix Digital`,
    react: (
      <InvoiceSentEmail
        firstName={invoice.client.firstName || "there"}
        invoiceNumber={invoice.invoiceNumber}
        amount={amount}
        projectName={invoice.project?.projectName}
        portalUrl={`${appUrl()}/portal/invoices/${invoice.id}`}
        paymentAccount={
          account
            ? {
                title: account.title,
                holderName: account.holderName,
                bankName: account.bankName,
                bankNote: account.bankNote,
                fields: (account.fields as { label: string; value: string }[]) ?? [],
              }
            : null
        }
        payLinkUrl={
          invoice.payLinkUrl && isSecureLink(invoice.payLinkUrl) ? invoice.payLinkUrl : null
        }
        pdfAttached={!!attachments}
      />
    ),
    attachments,
    devHint: `invoice ${invoice.invoiceNumber} → ${invoice.client.email}`,
  });
  if (!sent.ok) {
    return { ok: false, error: "Email failed to send — check the Resend configuration." };
  }

  await prisma.invoice.update({
    where: { id },
    data: {
      sentAt: new Date(),
      // A draft or an unsent invoice is now with the client. Don't regress
      // a further-along status back to SENT.
      ...(invoice.status === "DRAFT" || invoice.status === "ASSIGNED"
        ? { status: "SENT" as const }
        : {}),
    },
  });

  after(() =>
    Promise.all([
      prisma.notification
        .create({
          data: {
            userId: invoice.client.id,
            type: "INVOICE_SENT",
            title: `Invoice ${invoice.invoiceNumber} is ready`,
            body: `${amount}${invoice.project ? ` · ${invoice.project.projectName}` : ""}`,
            link: `/portal/invoices/${invoice.id}`,
          },
        })
        .catch((err: Error) => console.error("[invoices] notification failed:", err.message)),
      logActivity({
        type: "invoice.sent",
        summary: `Invoice ${invoice.invoiceNumber} sent · ${amount}`,
        clientId: invoice.client.id,
        projectId: invoice.projectId,
        entity: "invoice",
        entityId: invoice.id,
        link: `/admin/invoices/${invoice.id}`,
      }),
    ]),
  );

  return { ok: true };
}
