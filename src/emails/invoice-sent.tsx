import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

export default function InvoiceSentEmail({
  firstName,
  invoiceNumber,
  amount,
  projectName,
  portalUrl,
}: {
  firstName: string;
  invoiceNumber: string;
  amount: string;
  projectName?: string | null;
  portalUrl: string;
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
        is ready in your Avix Digital portal. You can review the details and
        download the PDF after signing in.
      </EmailBody>
      <EmailButton href={portalUrl}>View invoice</EmailButton>
    </EmailShell>
  );
}
