import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

export default function TaskRequestReceivedEmail({
  firstName,
  title,
  projectName,
  portalUrl,
}: {
  firstName: string;
  title: string;
  projectName: string;
  portalUrl: string;
}) {
  return (
    <EmailShell preview="We received your task request">
      <EmailHeading>Request received ✓</EmailHeading>
      <EmailBody>
        Hi {firstName}, thanks — we&apos;ve received your task request{" "}
        <strong>“{title}”</strong> on <strong>{projectName}</strong>.
      </EmailBody>
      <EmailBody>
        Our team will review it shortly. You&apos;ll get another email as soon
        as it&apos;s approved (with pricing if applicable) or if we need to
        discuss the scope.
      </EmailBody>
      <EmailButton href={portalUrl}>Track your request</EmailButton>
    </EmailShell>
  );
}
