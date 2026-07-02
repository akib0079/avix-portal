import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

export default function TaskRequestSubmittedEmail({
  clientName,
  projectName,
  title,
  adminUrl,
}: {
  clientName: string;
  projectName: string;
  title: string;
  adminUrl: string;
}) {
  return (
    <EmailShell preview={`New task request from ${clientName}`}>
      <EmailHeading>New task request</EmailHeading>
      <EmailBody>
        <strong>{clientName}</strong> submitted a task request on{" "}
        <strong>{projectName}</strong>:
      </EmailBody>
      <EmailBody>“{title}”</EmailBody>
      <EmailBody>
        Review it in the admin panel to approve it with pricing or reject it
        with a note.
      </EmailBody>
      <EmailButton href={adminUrl}>Review request</EmailButton>
    </EmailShell>
  );
}
