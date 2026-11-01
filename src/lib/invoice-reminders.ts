/**
 * When the duties engine reminds a client about an invoice.
 *
 * A friendly note PRE_DUE_DAYS before the due date, then reminders 1, 7, 14
 * and 30 days after it, and then nothing more: a client who hasn't paid after
 * a month needs a person, not a fifth email. The old chaser started only
 * once an invoice was late and then sent one every 7 days for ever, including
 * to clients who had already said they paid.
 *
 * Never reminded: drafts, unsent and cancelled invoices, credit notes,
 * anything paid or with nothing left owing, an invoice the client says they
 * have paid (the owner gets a "Confirm payment" task instead), and any the
 * owner paused. Nor in the first SENT_QUIET_DAYS after the invoice was
 * emailed, when the invoice email itself is the reminder.
 *
 * Dependency-free so the duty, the invoice page and the tests agree.
 */
import type { InvoiceStatus } from "@prisma/client";

/** Overdue reminders go out this many days after the due date. */
export const OVERDUE_STEPS = [1, 7, 14, 30] as const;
/** The heads-up goes out this many days before the due date. */
export const PRE_DUE_DAYS = 3;
/** No reminder this soon after the invoice itself was emailed. */
export const SENT_QUIET_DAYS = 2;
/**
 * Overdue reminders are never closer together than this. The steps are 6+
 * days apart anyway; this covers a reminder the old weekly chaser had just
 * sent when this schedule took over, and a manual resend.
 */
export const OVERDUE_GAP_DAYS = 5;

const DAY_MS = 86_400_000;

export type ReminderState = {
  status: InvoiceStatus;
  creditNoteForId: string | null;
  remindersPaused: boolean;
  paymentClaimedAt: Date | null;
  dueDate: Date | null;
  sentAt: Date | null;
  /** Overdue reminders already sent (steps taken). */
  reminderCount: number;
  /** When the last overdue reminder went out. */
  lastReminderAt: Date | null;
  preDueReminderAt: Date | null;
  /** Still owed after payments and credit notes. */
  balance: number;
};

export type ReminderDue =
  | { kind: "upcoming" }
  | {
      kind: "overdue";
      /** The reminderCount to stamp: every step that has come due by now. */
      step: number;
      daysOverdue: number;
      /** The last one the chaser will send. */
      final: boolean;
    };

/** Whether an invoice is the kind that gets reminders at all. */
export function isRemindable(invoice: ReminderState): boolean {
  return (
    (invoice.status === "SENT" || invoice.status === "PARTIALLY_PAID") &&
    !invoice.creditNoteForId &&
    !invoice.remindersPaused &&
    !invoice.paymentClaimedAt &&
    invoice.balance > 0 &&
    invoice.dueDate !== null
  );
}

/** Whole days past the due date (0 on the due date itself). */
export function daysOverdue(dueDate: Date, now: Date): number {
  return Math.floor((now.getTime() - dueDate.getTime()) / DAY_MS);
}

/** How many overdue steps have come due this many days after the due date. */
export function stepsDue(days: number): number {
  return OVERDUE_STEPS.filter((step) => days >= step).length;
}

/**
 * The reminder due right now, if any. Steps the chaser missed (it only runs
 * when something triggers it) are caught up with one email, not one per
 * step: `step` jumps straight to the count for today.
 */
export function reminderDue(invoice: ReminderState, now: Date): ReminderDue | null {
  if (!isRemindable(invoice)) return null;
  if (invoice.sentAt && now.getTime() - invoice.sentAt.getTime() < SENT_QUIET_DAYS * DAY_MS) {
    return null;
  }
  const due = invoice.dueDate!;
  const untilDue = due.getTime() - now.getTime();
  if (untilDue > 0) {
    return untilDue <= PRE_DUE_DAYS * DAY_MS && !invoice.preDueReminderAt
      ? { kind: "upcoming" }
      : null;
  }
  const days = daysOverdue(due, now);
  const step = stepsDue(days);
  if (step <= invoice.reminderCount) return null;
  if (
    invoice.lastReminderAt &&
    now.getTime() - invoice.lastReminderAt.getTime() < OVERDUE_GAP_DAYS * DAY_MS
  ) {
    return null;
  }
  return { kind: "overdue", step, daysOverdue: days, final: step === OVERDUE_STEPS.length };
}

/**
 * When the next reminder will go out, for the invoice page. Approximate by
 * design: the chaser runs whenever the app is visited or pinged, at most
 * every 15 minutes, so this is the earliest it can go.
 */
export function nextReminder(
  invoice: ReminderState,
  now: Date,
): { at: Date; kind: "upcoming" | "overdue" } | null {
  if (!isRemindable(invoice)) return null;
  const due = invoice.dueDate!.getTime();
  const quietUntil = invoice.sentAt ? invoice.sentAt.getTime() + SENT_QUIET_DAYS * DAY_MS : 0;
  const notBefore = (at: number) => new Date(Math.max(at, quietUntil, now.getTime()));

  if (!invoice.preDueReminderAt && due > now.getTime()) {
    const at = notBefore(due - PRE_DUE_DAYS * DAY_MS);
    // A quiet period that runs past the due date skips the heads-up.
    if (at.getTime() < due) return { at, kind: "upcoming" };
  }
  // The next step not yet sent, counting any a catch-up would skip.
  const taken = Math.max(invoice.reminderCount, stepsDue(daysOverdue(invoice.dueDate!, now)) - 1);
  const step = OVERDUE_STEPS[taken];
  if (step === undefined) return null;
  const gapUntil = invoice.lastReminderAt
    ? invoice.lastReminderAt.getTime() + OVERDUE_GAP_DAYS * DAY_MS
    : 0;
  return { at: notBefore(Math.max(due + step * DAY_MS, gapUntil)), kind: "overdue" };
}

/**
 * One line for the invoice page: what the chaser will do next for this
 * invoice, or why it won't do anything. `formatDay` renders a date.
 */
export function reminderSummary(
  invoice: ReminderState,
  now: Date,
  formatDay: (date: Date) => string,
): string {
  if (invoice.remindersPaused) {
    return "Reminders are paused for this invoice. The client won't be chased until you resume them.";
  }
  if (invoice.status === "DRAFT" || invoice.status === "ASSIGNED") {
    return "Reminders start once the invoice has been sent.";
  }
  if (invoice.paymentClaimedAt || invoice.status === "IN_REVIEW") {
    return "No reminders while the client's payment is waiting for you to confirm it.";
  }
  if (!invoice.dueDate) return "No due date, so no reminders.";
  if (!isRemindable(invoice)) return "Nothing is owed, so no reminders.";

  const next = nextReminder(invoice, now);
  const sent = `${invoice.reminderCount} of ${OVERDUE_STEPS.length} overdue reminders sent.`;
  if (!next) {
    return `All ${OVERDUE_STEPS.length} overdue reminders have gone out. This one needs a personal follow-up.`;
  }
  const when = next.at.getTime() <= now.getTime() ? "shortly" : `on ${formatDay(next.at)}`;
  return next.kind === "upcoming"
    ? `A friendly heads-up goes out ${when}, before the due date.`
    : `Next reminder ${when}. ${sent}`;
}
