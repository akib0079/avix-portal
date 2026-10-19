import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

/**
 * Something happened on a project board card that needs the reader: a new card
 * pinned to them, a help request, a mention, a card waiting on their review.
 * One template for all of them — the heading carries the event, the quote
 * carries what was actually said, so the email can be acted on from the inbox.
 */
export default function BoardActivityEmail({
  recipientFirstName,
  heading,
  intro,
  projectName,
  taskTitle,
  quote,
  url,
}: {
  recipientFirstName: string;
  heading: string;
  /** One sentence: who did what. */
  intro: string;
  projectName: string;
  taskTitle: string;
  quote?: string | null;
  url: string;
}) {
  return (
    <EmailShell preview={`${heading} — ${taskTitle}`}>
      <EmailHeading>{heading}</EmailHeading>
      <EmailBody>
        Hi {recipientFirstName}, {intro}
      </EmailBody>
      <EmailBody>
        <strong>{taskTitle}</strong>
        <br />
        <span style={{ color: "#64748b" }}>{projectName}</span>
      </EmailBody>
      {quote ? (
        <EmailBody>
          <em>“{quote}”</em>
        </EmailBody>
      ) : null}
      <EmailButton href={url}>Open the task</EmailButton>
    </EmailShell>
  );
}
