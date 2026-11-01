import "server-only";
import { Resend } from "resend";
import type { ReactElement } from "react";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = process.env.EMAIL_FROM ?? "Avix Digital <onboarding@resend.dev>";

/**
 * True when this process must not send real email: a dev server, or a local
 * production build (next build && next start) whose app URL is localhost.
 *
 * The local .env carries a live Resend key, and the admin layout runs the
 * duties engine on every page view. A local test run once emailed six
 * "invoice overdue" reminders, with localhost links, to a real mailbox. Now a
 * local process logs instead, unless ALLOW_DEV_EMAIL=1 says otherwise. The
 * deployed app sets a real https URL, so it is unaffected.
 */
function isLocalRuntime(): boolean {
  if (process.env.ALLOW_DEV_EMAIL === "1") return false;
  if (process.env.NODE_ENV !== "production") return true;
  // BETTER_AUTH_URL only: NEXT_PUBLIC_* is inlined at build time, which froze
  // a local build's localhost into the bundle (see src/lib/app-url.ts).
  const appUrl = process.env.BETTER_AUTH_URL ?? "";
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(appUrl);
}

/**
 * Sends an email via Resend. Without RESEND_API_KEY, or in any local run (see
 * isLocalRuntime), it logs the payload to the server console instead of
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
  if (!resend || isLocalRuntime()) {
    // devHint carries single-use bearer URLs (password reset, account invite).
    // Printing those to stdout is the right trade locally; in production the
    // same line would put a working credential into the host's log store, so
    // the hint is withheld and the missing key is reported as the fault it is.
    const isProd = process.env.NODE_ENV === "production" && !isLocalRuntime();
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
