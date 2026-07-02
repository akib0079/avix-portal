import "server-only";
import { sendEmail } from "@/lib/email/resend";
import WelcomeInviteEmail from "@/emails/welcome-invite";
import ResetPasswordEmail from "@/emails/reset-password";

export async function sendPasswordLinkEmail(options: {
  to: string;
  name: string;
  url: string;
  /** true = first-time invite (welcome template), false = password reset */
  invited: boolean;
}) {
  const firstName = options.name.split(" ")[0] || "there";
  await sendEmail({
    to: options.to,
    subject: options.invited
      ? "Welcome to your Avix Digital client portal"
      : "Reset your Avix Digital portal password",
    react: options.invited ? (
      <WelcomeInviteEmail firstName={firstName} setPasswordUrl={options.url} />
    ) : (
      <ResetPasswordEmail firstName={firstName} resetUrl={options.url} />
    ),
    devHint: `${options.invited ? "invite" : "reset"} link: ${options.url}`,
  });
}
