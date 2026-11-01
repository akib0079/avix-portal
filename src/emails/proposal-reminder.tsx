import { Text } from "@react-email/components";
import { EmailShell, EmailHeading, EmailBody, EmailButton, brand } from "./theme";

/**
 * The automatic "still interested?" note a few days before a proposal's link
 * runs out. It goes out unattended, so it is short and easy to ignore: one
 * reminder of what was offered, when it lapses, and the same link as before.
 * Money/date strings are pre-formatted by the caller.
 */
export default function ProposalReminderEmail({
  recipientName,
  title,
  totalText,
  timeLeftText,
  validUntilText,
  acceptUrl,
}: {
  recipientName: string;
  title: string;
  totalText: string;
  /** "tomorrow", "in 3 days". */
  timeLeftText: string;
  validUntilText: string;
  acceptUrl: string;
}) {
  return (
    <EmailShell preview={`Your proposal for ${title} expires ${timeLeftText}`}>
      <EmailHeading>A quick reminder about your proposal</EmailHeading>
      <EmailBody>
        Hi {recipientName}, our proposal for <strong>{title}</strong> is still open, and
        the link expires {timeLeftText} ({validUntilText}).
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
        <Text style={{ color: "#334155", fontSize: "14px", margin: 0 }}>
          Total: <strong>{totalText}</strong>
        </Text>
      </div>

      <EmailButton href={acceptUrl}>Review proposal</EmailButton>

      <EmailBody>
        Questions, or need a change to the scope? Just reply to this email. And if
        the timing isn&apos;t right, you can decline from the same page and we
        won&apos;t chase you.
      </EmailBody>
    </EmailShell>
  );
}
