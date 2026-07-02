import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

export default function MilestoneUpdatedEmail({
  firstName,
  milestoneTitle,
  projectName,
  portalUrl,
}: {
  firstName: string;
  milestoneTitle: string;
  projectName: string;
  portalUrl: string;
}) {
  return (
    <EmailShell preview={`Task updated on ${projectName}`}>
      <EmailHeading>A task was updated</EmailHeading>
      <EmailBody>
        Hi {firstName}, the details of <strong>“{milestoneTitle}”</strong> on{" "}
        <strong>{projectName}</strong> were just updated by our team.
      </EmailBody>
      <EmailBody>
        Open your project timeline to see the latest description, scope, or
        pricing for this task.
      </EmailBody>
      <EmailButton href={portalUrl}>See what changed</EmailButton>
    </EmailShell>
  );
}
