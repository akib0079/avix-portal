import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

export default function TaskRequestApprovedEmail({
  firstName,
  title,
  projectName,
  pricingLine,
  portalUrl,
}: {
  firstName: string;
  title: string;
  projectName: string;
  pricingLine: string | null;
  portalUrl: string;
}) {
  return (
    <EmailShell preview={`Your task request was approved`}>
      <EmailHeading>Request approved 🎉</EmailHeading>
      <EmailBody>
        Hi {firstName}, your task request <strong>“{title}”</strong> on{" "}
        <strong>{projectName}</strong> has been approved and added to the
        project board{pricingLine ? <> with pricing <strong>{pricingLine}</strong></> : null}.
      </EmailBody>
      <EmailBody>
        You can follow its progress from your portal like any other milestone.
      </EmailBody>
      <EmailButton href={portalUrl}>View project</EmailButton>
    </EmailShell>
  );
}
