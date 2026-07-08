import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

export default function ProjectCreatedEmail({
  firstName,
  projectName,
  projectType,
  portalUrl,
}: {
  firstName: string;
  projectName: string;
  projectType: string;
  portalUrl: string;
}) {
  return (
    <EmailShell preview={`Your project "${projectName}" is set up`}>
      <EmailHeading>Your project is set up 🎉</EmailHeading>
      <EmailBody>
        Hi {firstName}, we&apos;ve created your project{" "}
        <strong>{projectName}</strong> ({projectType}) in your Avix Digital
        portal. We&apos;ve laid out the milestones and you can follow every step
        of the progress as we work.
      </EmailBody>
      <EmailBody>
        You&apos;ll get updates inside the portal as milestones move forward —
        sign in any time to see where things stand or message us directly.
      </EmailBody>
      <EmailButton href={portalUrl}>View your project</EmailButton>
    </EmailShell>
  );
}
