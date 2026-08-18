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
  /** Optional file attachments (e.g. a generated invoice PDF). */
  attachments?: { filename: string; content: Buffer }[];
  /** Extra SMTP headers, e.g. List-Unsubscribe on marketing sends. */
  headers?: Record<string, string>;
  /** Logged in dev when no API key is configured (e.g. an invite link). */
  devHint?: string;
}) {
  if (!resend) {
    // devHint carries single-use bearer URLs (password reset, account invite).
    // Printing those to stdout is the right trade locally; in production the
    // same line would put a working credential into the host's log store, so
    // the hint is withheld and the missing key is reported as the fault it is.
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) {
      console.error(
        `[email] RESEND_API_KEY is not configured — mail to ${options.to} was NOT sent.`,
      );
      return { ok: true as const, skipped: true as const };
    }
    console.log(
      `[email:dev] to=${options.to} subject="${options.subject}"` +
        (options.attachments?.length ? ` attachments=${options.attachments.length}` : "") +
        (options.devHint ? `\n[email:dev] ${options.devHint}` : ""),
    );
    return { ok: true as const, skipped: true as const };
  }
  const { error } = await resend.emails.send({
    from: FROM,
    to: options.to,
    subject: options.subject,
    react: options.react,
    ...(options.attachments?.length
      ? { attachments: options.attachments.map((a) => ({ filename: a.filename, content: a.content })) }
      : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
  if (error) {
    console.error("[email] send failed:", error);
    return { ok: false as const, skipped: false as const };
  }
  return { ok: true as const, skipped: false as const };
}
