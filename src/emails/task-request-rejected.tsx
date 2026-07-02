import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

export default function TaskRequestRejectedEmail({
  firstName,
  title,
  projectName,
  reason,
  portalUrl,
}: {
  firstName: string;
  title: string;
  projectName: string;
  reason: string;
  portalUrl: string;
}) {
  return (
    <EmailShell preview="Update on your task request">
      <EmailHeading>About your task request</EmailHeading>
      <EmailBody>
        Hi {firstName}, we&apos;ve reviewed your request{" "}
        <strong>“{title}”</strong> on <strong>{projectName}</strong> and
        can&apos;t take it on as submitted. Here&apos;s the note from our team:
      </EmailBody>
      <EmailBody>
        <em>“{reason}”</em>
      </EmailBody>
      <EmailBody>
        Feel free to submit an updated request from your portal, or reply to
        this email if you&apos;d like to talk it through.
      </EmailBody>
      <EmailButton href={portalUrl}>Open portal</EmailButton>
    </EmailShell>
  );
}
