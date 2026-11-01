import "server-only";
import { sendEmail } from "@/lib/email/resend";
import { appUrl } from "@/lib/app-url";
import { formatCurrency } from "@/lib/currency";
import { createProposalToken } from "@/lib/marketing-token";
import ProposalSentEmail from "@/emails/proposal-sent";
import ProposalReminderEmail from "@/emails/proposal-reminder";
import ProposalSignedEmail from "@/emails/proposal-signed";

/**
 * The proposal emails, shared by the send / extend actions and the duties
 * engine's reminders, so a link is always minted the same way: for the row's
 * CURRENT linkVersion and expiry, which is what the public page will accept.
 */

/** The public link for a proposal as it stands. */
export function proposalUrl(p: { id: string; expiresAt: Date; linkVersion: number }): string {
  const token = createProposalToken(p.id, p.expiresAt.getTime(), p.linkVersion);
  return `${appUrl()}/proposals/${p.id}?token=${token}`;
}

function longDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function firstNameOf(name: string): string {
  const [first] = name.trim().split(/\s+/);
  return first || name;
}

export async function emailProposal(input: {
  to: string;
  recipientName: string;
  title: string;
  intro: string | null;
  total: number;
  currency: string;
  timelineWeeks: number | null;
  expiresAt: Date;
  url: string;
  variant: "sent" | "resent" | "extended";
}) {
  await sendEmail({
    to: input.to,
    subject:
      input.variant === "sent"
        ? `Your proposal from Avix Digital: ${input.title}`
        : `New link to your proposal from Avix Digital: ${input.title}`,
    react: (
      <ProposalSentEmail
        recipientName={firstNameOf(input.recipientName)}
        title={input.title}
        intro={input.variant === "sent" ? input.intro : null}
        totalText={formatCurrency(input.total, input.currency)}
        timelineText={
          input.timelineWeeks
            ? `Timeline: ${input.timelineWeeks} week${input.timelineWeeks === 1 ? "" : "s"}`
            : null
        }
        validUntilText={longDate(input.expiresAt)}
        acceptUrl={input.url}
        variant={input.variant}
      />
    ),
    devHint: `proposal (${input.variant}) ${input.title} → ${input.to}`,
  });
}

export async function emailProposalReminder(input: {
  to: string;
  recipientName: string;
  title: string;
  total: number;
  currency: string;
  timeLeftText: string;
  expiresAt: Date;
  url: string;
}) {
  await sendEmail({
    to: input.to,
    subject: `Reminder: your proposal for ${input.title} expires ${input.timeLeftText}`,
    react: (
      <ProposalReminderEmail
        recipientName={firstNameOf(input.recipientName)}
        title={input.title}
        totalText={formatCurrency(input.total, input.currency)}
        timeLeftText={input.timeLeftText}
        validUntilText={longDate(input.expiresAt)}
        acceptUrl={input.url}
      />
    ),
    devHint: `proposal reminder ${input.title} → ${input.to}`,
  });
}

/** The signer's copy of what they signed, with the PDF when there is one. */
export async function emailSignedProposal(input: {
  to: string;
  signerName: string;
  title: string;
  signedAt: Date;
  documentHash: string;
  viewUrl: string;
  pdf: { filename: string; content: Buffer } | null;
  portalInvite: boolean;
}) {
  await sendEmail({
    to: input.to,
    subject: `Signed: ${input.title}`,
    react: (
      <ProposalSignedEmail
        recipientName={firstNameOf(input.signerName)}
        title={input.title}
        signedAtText={new Intl.DateTimeFormat("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: "UTC",
          timeZoneName: "short",
        }).format(input.signedAt)}
        fingerprintText={input.documentHash}
        viewUrl={input.viewUrl}
        pdfAttached={input.pdf != null}
        portalInvite={input.portalInvite}
      />
    ),
    attachments: input.pdf ? [input.pdf] : undefined,
    devHint: `signed proposal ${input.title} → ${input.to}`,
  });
}
