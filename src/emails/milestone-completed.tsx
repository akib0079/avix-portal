import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

export default function MilestoneCompletedEmail({
  firstName,
  milestoneTitle,
  projectName,
  done,
  total,
  portalUrl,
}: {
  firstName: string;
  milestoneTitle: string;
  projectName: string;
  done: number;
  total: number;
  portalUrl: string;
}) {
  const allDone = total > 0 && done >= total;
  return (
    <EmailShell preview={`Milestone completed on ${projectName}`}>
      <EmailHeading>
        {allDone ? "Project milestone — all done! 🎉" : "Milestone completed ✓"}
      </EmailHeading>
      <EmailBody>
        Hi {firstName}, good news — <strong>“{milestoneTitle}”</strong> on{" "}
        <strong>{projectName}</strong> is now complete.
      </EmailBody>
      <EmailBody>
        That&apos;s <strong>{done} of {total}</strong> milestones finished
        {allDone
          ? " — every step on the board is done. We'll be in touch about the wrap-up."
          : ". You can see what's next on your project timeline."}
      </EmailBody>
      <EmailButton href={portalUrl}>View project progress</EmailButton>
    </EmailShell>
  );
}
