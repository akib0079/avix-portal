import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isRemindable,
  nextReminder,
  reminderDue,
  reminderSummary,
  stepsDue,
  type ReminderState,
} from "./invoice-reminders";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const at = (iso: string) => new Date(iso);

function invoice(overrides: Partial<ReminderState> = {}): ReminderState {
  return {
    status: "SENT",
    creditNoteForId: null,
    remindersPaused: false,
    paymentClaimedAt: null,
    dueDate: day("2026-11-10"),
    sentAt: day("2026-10-27"),
    reminderCount: 0,
    lastReminderAt: null,
    preDueReminderAt: null,
    balance: 500,
    ...overrides,
  };
}

test("a friendly note three days before the due date, once", () => {
  assert.equal(reminderDue(invoice(), at("2026-11-06T12:00:00Z")), null, "four days out: not yet");
  assert.deepEqual(reminderDue(invoice(), at("2026-11-07T00:00:00Z")), { kind: "upcoming" });
  assert.deepEqual(reminderDue(invoice(), at("2026-11-09T18:00:00Z")), { kind: "upcoming" });
  assert.equal(
    reminderDue(invoice({ preDueReminderAt: at("2026-11-07T01:00:00Z") }), at("2026-11-08T00:00:00Z")),
    null,
  );
});

test("overdue reminders at +1, +7, +14 and +30 days, then nothing", () => {
  const sent = { preDueReminderAt: at("2026-11-07T01:00:00Z") };
  assert.equal(reminderDue(invoice(sent), at("2026-11-10T09:00:00Z")), null, "due today is not late");
  assert.deepEqual(reminderDue(invoice(sent), at("2026-11-11T00:00:00Z")), {
    kind: "overdue",
    step: 1,
    daysOverdue: 1,
    final: false,
  });
  assert.equal(reminderDue(invoice({ ...sent, reminderCount: 1 }), at("2026-11-16T00:00:00Z")), null);
  assert.equal(reminderDue(invoice({ ...sent, reminderCount: 1 }), at("2026-11-17T00:00:00Z"))?.kind, "overdue");
  assert.deepEqual(reminderDue(invoice({ ...sent, reminderCount: 3 }), at("2026-12-10T00:00:00Z")), {
    kind: "overdue",
    step: 4,
    daysOverdue: 30,
    final: true,
  });
  assert.equal(reminderDue(invoice({ ...sent, reminderCount: 4 }), at("2027-03-01T00:00:00Z")), null);
});

test("missed steps are caught up with one reminder, not one per step", () => {
  const due = reminderDue(invoice({ preDueReminderAt: at("2026-11-07T00:00:00Z") }), at("2026-11-30T00:00:00Z"));
  assert.deepEqual(due, { kind: "overdue", step: 3, daysOverdue: 20, final: false });
  assert.equal(stepsDue(0), 0);
  assert.equal(stepsDue(6), 1);
  assert.equal(stepsDue(45), 4);
});

test("nobody is chased who shouldn't be", () => {
  const late = at("2026-11-20T00:00:00Z");
  assert.ok(reminderDue(invoice(), late));
  assert.equal(reminderDue(invoice({ status: "PARTIALLY_PAID" }), late)?.kind, "overdue");
  for (const status of ["DRAFT", "ASSIGNED", "IN_REVIEW", "PAID", "CANCELLED"] as const) {
    assert.equal(reminderDue(invoice({ status }), late), null, status);
  }
  assert.equal(reminderDue(invoice({ creditNoteForId: "inv_1" }), late), null, "credit note");
  assert.equal(reminderDue(invoice({ remindersPaused: true }), late), null, "paused");
  assert.equal(reminderDue(invoice({ paymentClaimedAt: day("2026-11-12") }), late), null, "claimed");
  assert.equal(reminderDue(invoice({ balance: 0 }), late), null, "nothing owed");
  assert.equal(reminderDue(invoice({ dueDate: null }), late), null, "no due date");
  assert.equal(isRemindable(invoice()), true);
});

test("no reminder in the two days after the invoice was emailed", () => {
  const justSent = invoice({ sentAt: at("2026-11-08T10:00:00Z") });
  assert.equal(reminderDue(justSent, at("2026-11-09T10:00:00Z")), null);
  assert.deepEqual(reminderDue(justSent, at("2026-11-10T10:00:01Z")), null, "past the due date's start");
  assert.equal(reminderDue(justSent, at("2026-11-11T00:00:00Z"))?.kind, "overdue");
});

test("the invoice page can say when the next reminder goes", () => {
  const now = at("2026-11-02T00:00:00Z");
  assert.deepEqual(nextReminder(invoice(), now), { at: day("2026-11-07"), kind: "upcoming" });
  assert.deepEqual(
    nextReminder(invoice({ preDueReminderAt: day("2026-11-07") }), now),
    { at: day("2026-11-11"), kind: "overdue" },
  );
  assert.deepEqual(
    nextReminder(invoice({ preDueReminderAt: day("2026-11-07"), reminderCount: 2 }), now),
    { at: day("2026-11-24"), kind: "overdue" },
  );
  assert.deepEqual(
    nextReminder(invoice({ preDueReminderAt: day("2026-11-07"), reminderCount: 3 }), now),
    { at: day("2026-12-10"), kind: "overdue" },
  );
  assert.equal(nextReminder(invoice({ reminderCount: 4, preDueReminderAt: now }), now), null);
  assert.equal(nextReminder(invoice({ remindersPaused: true }), now), null);
  // Overdue with steps missed: the catch-up is due now.
  const late = at("2026-11-30T00:00:00Z");
  assert.deepEqual(
    nextReminder(invoice({ preDueReminderAt: day("2026-11-07") }), late),
    { at: late, kind: "overdue" },
  );
});

test("overdue reminders keep a gap from the last one, whoever sent it", () => {
  // The old weekly chaser emailed three days ago; the catch-up waits.
  const chased = invoice({
    preDueReminderAt: day("2026-11-07"),
    lastReminderAt: day("2026-11-27"),
  });
  assert.equal(reminderDue(chased, at("2026-11-30T00:00:00Z")), null);
  assert.equal(reminderDue(chased, at("2026-12-02T00:00:00Z"))?.kind, "overdue");
  assert.deepEqual(nextReminder(chased, at("2026-11-30T00:00:00Z")), {
    at: day("2026-12-02"),
    kind: "overdue",
  });
});

test("the invoice page's one-line summary", () => {
  const now = at("2026-11-02T00:00:00Z");
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  assert.match(reminderSummary(invoice(), now, fmt), /heads-up goes out on 2026-11-07/);
  assert.match(reminderSummary(invoice({ remindersPaused: true }), now, fmt), /paused/);
  assert.match(reminderSummary(invoice({ status: "DRAFT" }), now, fmt), /once the invoice has been sent/);
  assert.match(reminderSummary(invoice({ status: "IN_REVIEW" }), now, fmt), /confirm/);
  assert.match(
    reminderSummary(invoice({ preDueReminderAt: now, reminderCount: 1 }), at("2026-11-12T00:00:00Z"), fmt),
    /Next reminder on 2026-11-17\. 1 of 4/,
  );
  assert.match(
    reminderSummary(invoice({ preDueReminderAt: now, reminderCount: 4 }), at("2027-01-12T00:00:00Z"), fmt),
    /personal follow-up/,
  );
});
