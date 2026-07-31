import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

/**
 * Overdue-invoice nudge. Deliberately gentle and factual — it goes out
 * automatically, so it must read fine even when the client has already paid
 * and we haven't recorded it yet.
 */
export default function InvoiceReminderEmail({
  firstName,
  invoiceNumber,
  amount,
  dueDate,
  daysOverdue,
  portalUrl,
}: {
  firstName: string;
  invoiceNumber: string;
  /** Formatted balance still outstanding. */
  amount: string;
  dueDate: string;
  daysOverdue: number;
  portalUrl: string;
}) {
  return (
    <EmailShell preview={`Invoice ${invoiceNumber} is overdue`}>
      <EmailHeading>A quick reminder about {invoiceNumber}</EmailHeading>
      <EmailBody>
        Hi {firstName}, invoice <strong>{invoiceNumber}</strong> for{" "}
        <strong>{amount}</strong> was due on {dueDate} — that&apos;s{" "}
        {daysOverdue} day{daysOverdue === 1 ? "" : "s"} ago.
      </EmailBody>
      <EmailBody>
        If it&apos;s already on its way, thank you — just reply and let us know so
        we can mark it off. Otherwise you can view the invoice and the payment
        details in your portal.
      </EmailBody>
      <EmailButton href={portalUrl}>View invoice</EmailButton>
      <EmailBody>
        Any questions about this invoice? Reply to this email and we&apos;ll sort
        it out.
      </EmailBody>
    </EmailShell>
  );
}
