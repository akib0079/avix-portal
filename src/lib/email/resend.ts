import "server-only";
import { Resend } from "resend";
import type { ReactElement } from "react";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = process.env.EMAIL_FROM ?? "Avix Digital <onboarding@resend.dev>";

/**
 * Sends an email via Resend. Without RESEND_API_KEY (local dev) it logs the
 * payload to the server console instead of failing, so flows stay testable.
 */
export async function sendEmail(options: {
  to: string;
  subject: string;
  react: ReactElement;
  /** Logged in dev when no API key is configured (e.g. an invite link). */
  devHint?: string;
}) {
  if (!resend) {
    console.log(
      `[email:dev] to=${options.to} subject="${options.subject}"` +
        (options.devHint ? `\n[email:dev] ${options.devHint}` : ""),
    );
    return { ok: true as const, skipped: true as const };
  }
  const { error } = await resend.emails.send({
    from: FROM,
    to: options.to,
    subject: options.subject,
    react: options.react,
  });
  if (error) {
    console.error("[email] send failed:", error);
    return { ok: false as const, skipped: false as const };
  }
  return { ok: true as const, skipped: false as const };
}
