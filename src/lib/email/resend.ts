import "server-only";
import { Resend } from "resend";
import type { ReactElement } from "react";
import { emailSendMode } from "@/lib/email/send-mode";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = process.env.EMAIL_FROM ?? "Avix Digital <onboarding@resend.dev>";

/**
 * Sends an email via Resend. Without RESEND_API_KEY, or in any local run (see
 * emailSendMode), it logs the payload to the server console instead of
 * sending, so flows stay testable and nobody gets mail from a laptop.
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
  const decision = emailSendMode({
    hasKey: !!resend,
    nodeEnv: process.env.NODE_ENV,
    appUrl: process.env.BETTER_AUTH_URL,
    allowDevEmail: process.env.ALLOW_DEV_EMAIL,
  });
  if (decision.mode === "refuse") {
    // Not a local run, so devHint (a single-use reset or invite URL) stays
    // out of the host's log store; the fault is reported instead.
    console.error(`[email] ${decision.reason} — mail to ${options.to} was NOT sent.`);
    return { ok: true as const, skipped: true as const };
  }
  if (decision.mode === "log" || !resend) {
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
