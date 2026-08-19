import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

/**
 * The email counterpart of an in-app admin notification.
 *
 * Deliberately generic: it renders whatever title/body notifyAllAdmins already
 * wrote for the bell, so a new notification type gets an email without needing
 * a new template. Events that deserve their own wording — a task request, a
 * client message — keep their bespoke templates and are excluded from this one.
 */
export default function AdminAlertEmail({
  title,
  body,
  actionUrl,
  actionLabel = "Open in admin",
}: {
  title: string;
  body?: string;
  actionUrl: string;
  actionLabel?: string;
}) {
  return (
    <EmailShell preview={title}>
      <EmailHeading>{title}</EmailHeading>
      {body ? <EmailBody>{body}</EmailBody> : null}
      <EmailButton href={actionUrl}>{actionLabel}</EmailButton>
    </EmailShell>
  );
}
