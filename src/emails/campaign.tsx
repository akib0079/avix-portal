import { Link, Text } from "@react-email/components";
import { EmailShell, brand } from "./theme";
import { RichTextEmail } from "./rich-text-email";

const footerAddress =
  process.env.EMAIL_FOOTER_ADDRESS || "Avix Digital · avixdigital.com";

/**
 * Marketing campaign email: branded shell + admin-authored rich-text body +
 * the legally required unsubscribe footer (CAN-SPAM/GDPR).
 */
export default function CampaignEmail({
  subject,
  body,
  unsubscribeUrl,
}: {
  subject: string;
  body: unknown;
  unsubscribeUrl: string;
}) {
  return (
    <EmailShell preview={subject}>
      <RichTextEmail content={body} />
      <Text
        style={{
          borderTop: `1px solid ${brand.border}`,
          color: brand.slate,
          fontSize: "11px",
          lineHeight: "17px",
          marginTop: "24px",
          paddingTop: "14px",
        }}
      >
        You&apos;re receiving this because you&apos;re a client of Avix Digital.{" "}
        {footerAddress}
        <br />
        <Link href={unsubscribeUrl} style={{ color: brand.slate, textDecoration: "underline" }}>
          Unsubscribe from marketing emails
        </Link>{" "}
        — project and invoice emails are unaffected.
      </Text>
    </EmailShell>
  );
}
