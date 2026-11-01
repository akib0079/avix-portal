import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

/**
 * Payment reminder: a heads-up before the due date, or a nudge after it.
 * Deliberately gentle and factual — it goes out automatically, so it must
 * read fine even when the client has already paid and we haven't recorded
 * it yet.
 */
export default function InvoiceReminderEmail({
  kind,
  firstName,
  invoiceNumber,
  amount,
  dueDate,
  daysOverdue = 0,
  final = false,
  portalUrl,
  payLinkUrl = null,
}: {
  /** "upcoming": due in a few days. "overdue": past its due date. */
  kind: "upcoming" | "overdue";
  firstName: string;
  invoiceNumber: string;
  /** Formatted balance still outstanding. */
  amount: string;
  dueDate: string;
  daysOverdue?: number;
  /** The last automatic reminder: after this one a person follows up. */
  final?: boolean;
  portalUrl: string;
  /** Hosted payment page for this invoice, https only. */
  payLinkUrl?: string | null;
}) {
  const upcoming = kind === "upcoming";
  return (
    <EmailShell
      preview={
        upcoming ? `Invoice ${invoiceNumber} is due on ${dueDate}` : `Invoice ${invoiceNumber} is overdue`
      }
    >
      <EmailHeading>
        {upcoming
          ? `${invoiceNumber} is due on ${dueDate}`
          : `A quick reminder about ${invoiceNumber}`}
      </EmailHeading>
      {upcoming ? (
        <EmailBody>
          Hi {firstName}, just a heads-up that invoice <strong>{invoiceNumber}</strong> for{" "}
          <strong>{amount}</strong> is due on {dueDate}. If it&apos;s already on its way,
          thank you, and please ignore this note.
        </EmailBody>
      ) : (
        <>
          <EmailBody>
            Hi {firstName}, invoice <strong>{invoiceNumber}</strong> for{" "}
            <strong>{amount}</strong> was due on {dueDate} — that&apos;s {daysOverdue} day
            {daysOverdue === 1 ? "" : "s"} ago.
          </EmailBody>
          <EmailBody>
            If it&apos;s already on its way, thank you — just reply and let us know so
            we can mark it off. Otherwise you can view the invoice and the payment
            details in your portal.
          </EmailBody>
        </>
      )}
      {payLinkUrl && <EmailButton href={payLinkUrl}>Pay online</EmailButton>}
      <EmailButton href={portalUrl}>View invoice</EmailButton>
      <EmailBody>
        {final
          ? "This is our last automatic reminder about this invoice. If something is holding it up, reply to this email and we'll sort it out together."
          : "Any questions about this invoice? Reply to this email and we'll sort it out."}
      </EmailBody>
    </EmailShell>
  );
}
