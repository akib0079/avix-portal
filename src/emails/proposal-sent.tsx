import { Text } from "@react-email/components";
import { EmailShell, EmailHeading, EmailBody, EmailButton, brand } from "./theme";

/**
 * Sent to a prospect when a proposal is shared. The button links to the signed,
 * expiring public accept page. Money/date strings are pre-formatted by the caller.
 */
export default function ProposalSentEmail({
  recipientName,
  title,
  intro,
  totalText,
  timelineText,
  validUntilText,
  acceptUrl,
}: {
  recipientName: string;
  title: string;
  intro: string | null;
  totalText: string;
  timelineText: string | null;
  validUntilText: string | null;
  acceptUrl: string;
}) {
  return (
    <EmailShell preview={`Your proposal from Avix Digital: ${title}`}>
      <EmailHeading>Here&apos;s your proposal 📄</EmailHeading>
      <EmailBody>
        Hi {recipientName}, thanks for the opportunity — here&apos;s how we&apos;d
        approach <strong>{title}</strong>. Review the scope below and accept online
        whenever you&apos;re ready.
      </EmailBody>

      {intro && (
        <Text style={{ color: "#334155", fontSize: "14px", margin: "0 0 16px", whiteSpace: "pre-wrap" }}>
          {intro}
        </Text>
      )}

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
          Total: <strong>{totalText}</strong>
        </Text>
        {timelineText && (
          <Text style={{ color: brand.slate, fontSize: "13px", margin: 0 }}>{timelineText}</Text>
        )}
      </div>

      <EmailButton href={acceptUrl}>View &amp; accept proposal</EmailButton>

      {validUntilText && (
        <Text style={{ color: brand.slate, fontSize: "13px", textAlign: "center", margin: "8px 0 0" }}>
          This proposal is valid until {validUntilText}.
        </Text>
      )}
    </EmailShell>
  );
}
