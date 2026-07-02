import { EmailShell, EmailHeading, EmailBody, EmailButton } from "./theme";

export default function WelcomeInviteEmail({
  firstName,
  setPasswordUrl,
}: {
  firstName: string;
  setPasswordUrl: string;
}) {
  return (
    <EmailShell preview="Your Avix Digital client portal is ready">
      <EmailHeading>Welcome to your client portal, {firstName}</EmailHeading>
      <EmailBody>
        Avix Digital has set up a private portal account for you. From your
        portal you can follow project progress in real time, review milestones,
        download invoices, and submit task requests.
      </EmailBody>
      <EmailBody>
        To get started, choose a password for your account. This link is valid
        for 24 hours — if it expires, ask us to send a new one.
      </EmailBody>
      <EmailButton href={setPasswordUrl}>Set your password</EmailButton>
    </EmailShell>
  );
}
