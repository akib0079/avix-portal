import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

export default function MessageReceivedEmail({
  recipientFirstName,
  senderName,
  projectName,
  preview,
  url,
}: {
  recipientFirstName: string;
  senderName: string;
  projectName: string;
  preview: string;
  url: string;
}) {
  return (
    <EmailShell preview={`New message on ${projectName}`}>
      <EmailHeading>New message</EmailHeading>
      <EmailBody>
        Hi {recipientFirstName}, <strong>{senderName}</strong> sent a message on{" "}
        <strong>{projectName}</strong>:
      </EmailBody>
      <EmailBody>
        <em>“{preview}”</em>
      </EmailBody>
      <EmailButton href={url}>Open the conversation</EmailButton>
    </EmailShell>
  );
}
