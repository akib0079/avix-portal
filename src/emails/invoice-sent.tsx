import { EmailShell, EmailHeading, EmailBody, EmailButton, brand } from "./theme";

type EmailPaymentAccount = {
  title: string;
  holderName: string;
  bankName: string;
  bankNote?: string | null;
  fields: { label: string; value: string }[];
};

export default function InvoiceSentEmail({
  firstName,
  invoiceNumber,
  amount,
  projectName,
  portalUrl,
  paymentAccounts = [],
  pdfAttached = false,
}: {
  firstName: string;
  invoiceNumber: string;
  amount: string;
  projectName?: string | null;
  portalUrl: string;
  paymentAccounts?: EmailPaymentAccount[];
  /** True when the generated PDF is attached to this email. */
  pdfAttached?: boolean;
}) {
  return (
    <EmailShell preview={`Invoice ${invoiceNumber} from Avix Digital`}>
      <EmailHeading>Invoice {invoiceNumber} is ready</EmailHeading>
      <EmailBody>
        Hi {firstName}, a new invoice for{" "}
        <strong>{amount}</strong>
        {projectName ? (
          <>
            {" "}
            on <strong>{projectName}</strong>
          </>
        ) : null}{" "}
        is ready.{" "}
        {pdfAttached
          ? "The invoice is attached to this email as a PDF, and you can also open it in your portal."
          : "Open it in your Avix Digital portal to review and download."}
      </EmailBody>
      <EmailButton href={portalUrl}>
        {pdfAttached ? "Download the invoice" : "View invoice"}
      </EmailButton>

      {paymentAccounts.length > 0 && (
        <>
          <EmailBody>
            <strong>How to pay</strong> — bank transfer. Please include{" "}
            <strong>{invoiceNumber}</strong> as the reference.
          </EmailBody>
          {paymentAccounts.map((account, i) => (
            <div
              key={i}
              style={{
                border: `1px solid ${brand.border}`,
                borderRadius: "8px",
                padding: "12px 16px",
                margin: "0 0 12px",
              }}
            >
              <p style={{ margin: "0 0 6px", fontSize: "13px", fontWeight: 700, color: brand.navy }}>
                {account.title}
              </p>
              <p style={{ margin: "0 0 8px", fontSize: "12px", color: brand.slate }}>
                {account.holderName} · {account.bankName}
                {account.bankNote ? ` · ${account.bankNote}` : ""}
              </p>
              {account.fields.map((f, j) => (
                <p key={j} style={{ margin: "0 0 2px", fontSize: "13px", color: "#334155" }}>
                  <span style={{ color: brand.slate }}>{f.label}:</span>{" "}
                  <strong>{f.value}</strong>
                </p>
              ))}
            </div>
          ))}
        </>
      )}
    </EmailShell>
  );
}
