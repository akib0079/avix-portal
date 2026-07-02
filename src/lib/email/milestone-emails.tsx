import "server-only";
import { sendEmail } from "@/lib/email/resend";
import MilestoneCompletedEmail from "@/emails/milestone-completed";
import MilestoneUpdatedEmail from "@/emails/milestone-updated";

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function sendMilestoneCompletedEmail(options: {
  to: string;
  firstName: string;
  milestoneTitle: string;
  projectName: string;
  projectId: string;
  done: number;
  total: number;
}) {
  await sendEmail({
    to: options.to,
    subject: `Milestone completed: ${options.milestoneTitle} — ${options.projectName}`,
    react: (
      <MilestoneCompletedEmail
        firstName={options.firstName || "there"}
        milestoneTitle={options.milestoneTitle}
        projectName={options.projectName}
        done={options.done}
        total={options.total}
        portalUrl={`${appUrl()}/portal/projects/${options.projectId}`}
      />
    ),
    devHint: `milestone completed (${options.done}/${options.total}) → ${options.to}`,
  });
}

export async function sendMilestoneUpdatedEmail(options: {
  to: string;
  firstName: string;
  milestoneTitle: string;
  projectName: string;
  projectId: string;
}) {
  await sendEmail({
    to: options.to,
    subject: `Task updated: ${options.milestoneTitle} — ${options.projectName}`,
    react: (
      <MilestoneUpdatedEmail
        firstName={options.firstName || "there"}
        milestoneTitle={options.milestoneTitle}
        projectName={options.projectName}
        portalUrl={`${appUrl()}/portal/projects/${options.projectId}`}
      />
    ),
    devHint: `milestone updated → ${options.to}`,
  });
}
