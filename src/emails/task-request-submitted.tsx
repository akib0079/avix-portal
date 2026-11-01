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
    <EmailShell preview={`New request from ${clientName}`}>
      <EmailHeading>New request</EmailHeading>
      <EmailBody>
        <strong>{clientName}</strong> asked for something new on{" "}
        <strong>{projectName}</strong>:
      </EmailBody>
      <EmailBody>“{title}”</EmailBody>
      <EmailBody>
        It waits in the project&apos;s Requested section. Accept it into the
        plan (and price it), or decline it with a note.
      </EmailBody>
      <EmailButton href={adminUrl}>Review request</EmailButton>
    </EmailShell>
  );
}
