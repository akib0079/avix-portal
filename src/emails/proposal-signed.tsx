import { Text } from "@react-email/components";
import { EmailShell, EmailHeading, EmailBody, EmailButton, brand } from "./theme";

/**
 * The signer's copy, sent once their signature is in: the signed PDF rides
 * along as an attachment (when it rendered), and the link opens the signed
 * proposal and its certificate whenever they need it again. The fingerprint is
 * printed so the email itself records which document was signed. Date and
 * hash strings are pre-formatted by the caller.
 */
export default function ProposalSignedEmail({
  recipientName,
  title,
  signedAtText,
  fingerprintText,
  viewUrl,
  pdfAttached,
  portalInvite,
}: {
  recipientName: string;
  title: string;
  signedAtText: string;
  fingerprintText: string;
  viewUrl: string;
  pdfAttached: boolean;
  /** A separate set-your-password email is on its way. */
  portalInvite: boolean;
}) {
  return (
    <EmailShell preview={`Your signed proposal: ${title}`}>
      <EmailHeading>Your signed proposal ✍️</EmailHeading>
      <EmailBody>
        Hi {recipientName}, thanks for signing <strong>{title}</strong>.{" "}
        {pdfAttached
          ? "Your signed copy is attached as a PDF."
          : "You can view and download your signed copy from the link below."}
      </EmailBody>

      <div
        style={{
          border: `1px solid ${brand.border}`,
          borderRadius: "8px",
          margin: "0 0 16px",
          padding: "14px 18px",
        }}
      >
        <Text style={{ color: brand.navy, fontSize: "15px", fontWeight: 700, margin: "0 0 4px" }}>
          {title}
        </Text>
        <Text style={{ color: "#334155", fontSize: "14px", margin: "0 0 2px" }}>
          Signed {signedAtText}
        </Text>
        <Text style={{ color: brand.slate, fontSize: "12px", margin: 0, wordBreak: "break-all" }}>
          Document fingerprint (SHA-256): {fingerprintText}
        </Text>
      </div>

      <EmailButton href={viewUrl}>View your signed proposal</EmailButton>

      <EmailBody>
        {portalInvite
          ? "We're also sending you a separate email to set up your client portal, where your project and first invoice will be waiting."
          : "Your project and first invoice are in your client portal."}{" "}
        Questions? Just reply to this email.
      </EmailBody>
    </EmailShell>
  );
}
