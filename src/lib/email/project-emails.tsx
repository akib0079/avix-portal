import "server-only";
import { sendEmail } from "@/lib/email/resend";
import { appUrl } from "@/lib/app-url";
import ProjectCreatedEmail from "@/emails/project-created";

/** One email to the client when a project is created for them. */
export async function sendProjectCreatedEmail(options: {
  to: string;
  firstName: string;
  projectName: string;
  projectType: string;
  projectId: string;
}) {
  await sendEmail({
    to: options.to,
    subject: `Your project "${options.projectName}" is set up`,
    react: (
      <ProjectCreatedEmail
        firstName={options.firstName || "there"}
        projectName={options.projectName}
        projectType={options.projectType}
        portalUrl={`${appUrl()}/portal/projects/${options.projectId}`}
      />
    ),
    devHint: `project created → ${options.to}`,
  });
}
