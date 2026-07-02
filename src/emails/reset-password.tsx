import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

export default function ResetPasswordEmail({
  firstName,
  resetUrl,
}: {
  firstName: string;
  resetUrl: string;
}) {
  return (
    <EmailShell preview="Reset your Avix Digital portal password">
      <EmailHeading>Reset your password</EmailHeading>
      <EmailBody>
        Hi {firstName}, we received a request to reset the password for your
        Avix Digital portal account. Click the button below to choose a new
        one. The link is valid for 24 hours.
      </EmailBody>
      <EmailBody>
        If you didn&apos;t request this, you can safely ignore this email —
        your password will stay unchanged.
      </EmailBody>
      <EmailButton href={resetUrl}>Choose a new password</EmailButton>
    </EmailShell>
  );
}
