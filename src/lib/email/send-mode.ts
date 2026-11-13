import { isLocalAppUrl, isLocalHost } from "@/lib/app-url";
import { isDeveloperPlatform } from "@/lib/dev-machine";

export type SendMode =
  | { mode: "send" }
  /** Log the payload, devHint included: this is a developer's own process. */
  | { mode: "log" }
  /** Don't send and withhold devHint: a deployed process that can't mail. */
  | { mode: "refuse"; reason: string };

/**
 * Decides whether sendEmail() sends, logs, or refuses.
 *
 * The local .env carries a live Resend key, and the admin layout runs the
 * duties engine on every page view. A local test run once emailed six
 * "invoice overdue" reminders, with localhost links, to a real mailbox. So
 * a local process logs instead, unless ALLOW_DEV_EMAIL=1 says otherwise:
 * a dev server, a run on a developer's computer (whatever its app URL, an
 * https tunnel included), or a production build whose app URL host is local.
 *
 * devHint carries single-use bearer URLs (password reset, account invite).
 * Printing those is the right trade on a developer's own process; anywhere
 * else the same line would put a working credential into the host's log
 * store. So a process that is only "not sending" because its app URL is plain
 * http on a public host (a misconfigured deploy) refuses, without the hint.
 * A blank URL is the deployed fallback and still sends.
 */
export function emailSendMode(opts: {
  hasKey: boolean;
  nodeEnv?: string;
  /** BETTER_AUTH_URL only: NEXT_PUBLIC_* is inlined at build time. */
  appUrl?: string;
  allowDevEmail?: string;
  platform?: string;
}): SendMode {
  const url = opts.appUrl ?? "";
  const ownMachine =
    opts.nodeEnv !== "production" || isDeveloperPlatform(opts.platform) || hostIsLocal(url);
  const allowed = opts.allowDevEmail === "1";
  if (!allowed && ownMachine) return { mode: "log" };
  if (!allowed && isLocalAppUrl(url)) {
    return { mode: "refuse", reason: "BETTER_AUTH_URL is not an https URL" };
  }
  if (!opts.hasKey) {
    return ownMachine ? { mode: "log" } : { mode: "refuse", reason: "RESEND_API_KEY is not configured" };
  }
  return { mode: "send" };
}

function hostIsLocal(url: string): boolean {
  if (!url) return false;
  try {
    return isLocalHost(new URL(url).hostname);
  } catch {
    return false;
  }
}
