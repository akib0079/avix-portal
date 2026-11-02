import assert from "node:assert/strict";
import { test } from "node:test";
import {
  depositAmount,
  draftInvoiceRemovable,
  dueProposalReminder,
  firstInvoicePromise,
  formatTotals,
  handoffContractPrice,
  invoiceKeptReason,
  keepLineFormatting,
  proposalRemovalMode,
  proposalRemovalPlan,
  timeAgo,
  totalsByCurrency,
  viewSummary,
} from "./proposal-rules";

const DAY = 24 * 60 * 60 * 1000;
const paperwork = {
  status: "ASSIGNED" as const,
  sentAt: null,
  amountPaid: 0,
  paymentCount: 0,
  paymentClaimedAt: null,
  creditNoteCount: 0,
  copiedByPlan: false,
};

test("only a draft that was never sent is deleted; everything else is archived", () => {
  assert.equal(proposalRemovalMode({ status: "DRAFT", sentAt: null }), "delete");
  assert.equal(proposalRemovalMode({ status: "DRAFT", sentAt: new Date() }), "archive");
  for (const status of ["SENT", "DECLINED", "EXPIRED", "ACCEPTED"] as const) {
    assert.equal(proposalRemovalMode({ status, sentAt: null }), "archive", status);
  }
});

test("the draft invoice goes only while it is still paperwork", () => {
  assert.equal(draftInvoiceRemovable(paperwork), true);
  assert.equal(draftInvoiceRemovable({ ...paperwork, status: "DRAFT" }), true);
  assert.equal(draftInvoiceRemovable({ ...paperwork, status: "SENT" }), false);
  assert.equal(draftInvoiceRemovable({ ...paperwork, status: "PAID" }), false);
  assert.equal(draftInvoiceRemovable({ ...paperwork, status: "CANCELLED" }), false);
  assert.equal(draftInvoiceRemovable({ ...paperwork, sentAt: "2026-11-01T10:00:00Z" }), false);
  assert.equal(draftInvoiceRemovable({ ...paperwork, amountPaid: 10 }), false);
  assert.equal(draftInvoiceRemovable({ ...paperwork, paymentCount: 1 }), false);
  assert.equal(draftInvoiceRemovable(null), false);
});

test("deleteInvoice's line holds: a claimed, credited or plan-copied invoice stays", () => {
  const claimed = { ...paperwork, paymentClaimedAt: "2026-11-01T10:00:00Z" };
  const credited = { ...paperwork, creditNoteCount: 1 };
  const copied = { ...paperwork, copiedByPlan: true };
  for (const invoice of [claimed, credited, copied]) {
    assert.equal(draftInvoiceRemovable(invoice), false);
    assert.deepEqual(proposalRemovalPlan({ status: "DRAFT", sentAt: null }, invoice), {
      mode: "delete",
      invoice: "keep",
    });
    assert.deepEqual(proposalRemovalPlan({ status: "SENT", sentAt: new Date() }, invoice), {
      mode: "archive",
      invoice: "keep",
    });
  }
  assert.equal(invoiceKeptReason(claimed), "the client reported paying it");
  assert.equal(invoiceKeptReason(credited), "credit notes were issued against it");
  assert.equal(invoiceKeptReason(copied), "a recurring plan copies it");
  assert.equal(invoiceKeptReason({ ...copied, sentAt: new Date() }), "it has already been sent");
  assert.equal(invoiceKeptReason({ ...paperwork, amountPaid: 5 }), "money has been recorded against it");
  assert.equal(invoiceKeptReason({ ...paperwork, status: "CANCELLED" }), "it is cancelled");
});

test("the removal plan: drafts take a safe invoice along, archives only offer it, accepted keeps it", () => {
  const draft = { status: "DRAFT" as const, sentAt: null };
  const sent = { status: "SENT" as const, sentAt: new Date() };
  const accepted = { status: "ACCEPTED" as const, sentAt: new Date() };
  const sentInvoice = { ...paperwork, status: "SENT" as const, sentAt: new Date() };

  assert.deepEqual(proposalRemovalPlan(draft, paperwork), { mode: "delete", invoice: "remove" });
  assert.deepEqual(proposalRemovalPlan(draft, sentInvoice), { mode: "delete", invoice: "keep" });
  assert.deepEqual(proposalRemovalPlan(draft, null), { mode: "delete", invoice: "none" });
  assert.deepEqual(proposalRemovalPlan(sent, paperwork), { mode: "archive", invoice: "offer" });
  assert.deepEqual(proposalRemovalPlan(sent, sentInvoice), { mode: "archive", invoice: "keep" });
  assert.deepEqual(proposalRemovalPlan(accepted, paperwork), { mode: "archive", invoice: "keep" });
});

test("a builder save keeps the formatting of the lines whose words it left alone", () => {
  const text = { type: "text", text: "Design", marks: [{ type: "bold" }] };
  const bold = { type: "doc", content: [{ type: "paragraph", content: [text] }] };
  const list = { type: "doc", content: [{ type: "bulletList" }] };
  const saved = [
    { description: "Design", descriptionRich: bold },
    { description: "Build\nPages and forms", descriptionRich: list },
    { description: "Hosting", descriptionRich: null },
  ];
  const row = (description: string, sortOrder: number) => ({ description, qty: 1, rate: 100, sortOrder });

  // A rate changed, the words didn't: everything keeps its formatting.
  const same = [row("Design", 0), row("Build\nPages and forms", 1), row("Hosting", 2)];
  assert.deepEqual(keepLineFormatting(saved, same), [
    { ...row("Design", 0), descriptionRich: bold },
    { ...row("Build\nPages and forms", 1), descriptionRich: list },
    row("Hosting", 2),
  ]);
  // An edited line drops its stale formatting; a moved one keeps its own.
  assert.deepEqual(keepLineFormatting(saved, [row("Build", 0), row("Design", 1)]), [
    row("Build", 0),
    { ...row("Design", 1), descriptionRich: bold },
  ]);
  // Two lines with the same words keep theirs in order, and a new third gets none.
  const twice = [
    { description: "Retainer", descriptionRich: null },
    { description: "Retainer", descriptionRich: list },
  ];
  const three = [row("Retainer", 0), row("Retainer", 1), row("Retainer", 2)];
  assert.deepEqual(keepLineFormatting(twice, three), [
    row("Retainer", 0),
    { ...row("Retainer", 1), descriptionRich: list },
    row("Retainer", 2),
  ]);
  assert.deepEqual(keepLineFormatting([], [row("New", 0)]), [row("New", 0)]);
});

test("totals are kept per currency and never added across them", () => {
  const totals = totalsByCurrency([
    { total: 1000, currency: "USD" },
    { total: 1500, currency: "GBP" },
    { total: 2000.5, currency: "USD" },
    { total: 0, currency: "EUR" },
  ]);
  assert.deepEqual(totals, [
    { code: "USD", total: 3000.5 },
    { code: "GBP", total: 1500 },
  ]);
  assert.equal(formatTotals(totals), "$3,000.50 + £1,500.00");
  assert.equal(formatTotals(totalsByCurrency([])), "");
});

test("a deposit is worked out in cents, half a cent rounding up", () => {
  assert.equal(depositAmount(3000, 50), 1500);
  assert.equal(depositAmount(1.15, 50), 0.58); // 57.4999… in floats
  assert.equal(depositAmount(1234.56, 33), 407.4);
  assert.equal(depositAmount(0.01, 50), 0.01);
  assert.equal(depositAmount(999.99, 0), 0);
  assert.equal(depositAmount(999.99, 100), 999.99);
});

test("the client is promised the invoice that is attached, else the deposit acceptance creates", () => {
  const proposal = { total: 3000, currency: "GBP", depositPercent: 50 };
  assert.deepEqual(
    firstInvoicePromise(proposal, { amount: 3000, currency: "EUR", status: "DRAFT" }),
    { kind: "invoice", amount: 3000, currency: "EUR" },
  );
  assert.deepEqual(firstInvoicePromise(proposal, null), {
    kind: "deposit",
    percent: 50,
    amount: 1500,
    currency: "GBP",
  });
  assert.deepEqual(
    firstInvoicePromise(proposal, { amount: 3000, currency: "GBP", status: "CANCELLED" }),
    { kind: "deposit", percent: 50, amount: 1500, currency: "GBP" },
  );
  assert.equal(firstInvoicePromise({ ...proposal, depositPercent: 0 }, null), null);
});

test("only a dollar proposal prices its project; another currency leaves it to the admin", () => {
  assert.equal(handoffContractPrice({ total: 10_000, currency: "USD" }), 10_000);
  assert.equal(handoffContractPrice({ total: 10_000, currency: "GBP" }), null);
  assert.equal(handoffContractPrice({ total: 0, currency: "USD" }), 0);
});

test("reminders: one per window, never on the heels of the send, one email when late", () => {
  const expiresAt = new Date("2026-12-01T12:00:00Z");
  const at = (daysLeft: number) => new Date(expiresAt.getTime() - daysLeft * DAY);
  const base = { expiresAt, sentAt: at(30), lastReminderAt: null as Date | null };

  assert.equal(dueProposalReminder(base, at(4)), null);
  assert.deepEqual(dueProposalReminder(base, at(2.9)), { daysBefore: 3 });
  // Reminded at 2.9 days: quiet until the 1-day window opens.
  assert.equal(dueProposalReminder({ ...base, lastReminderAt: at(2.9) }, at(1.5)), null);
  assert.deepEqual(dueProposalReminder({ ...base, lastReminderAt: at(2.9) }, at(0.9)), { daysBefore: 1 });
  assert.equal(dueProposalReminder({ ...base, lastReminderAt: at(0.9) }, at(0.5)), null);
  // The duties didn't run for days: only the closest window fires.
  assert.deepEqual(dueProposalReminder(base, at(0.5)), { daysBefore: 1 });
  // Sent with two days to run: no "3 days left", but the 1-day one still comes.
  assert.equal(dueProposalReminder({ ...base, sentAt: at(2) }, at(1.5)), null);
  assert.deepEqual(dueProposalReminder({ ...base, sentAt: at(2) }, at(0.5)), { daysBefore: 1 });
  // A one-day proposal gets nothing; an expired one gets nothing.
  assert.equal(dueProposalReminder({ ...base, sentAt: at(1) }, at(0.5)), null);
  assert.equal(dueProposalReminder(base, at(-0.1)), null);
  // Extended after a reminder: the new windows count afresh.
  const extended = { expiresAt: new Date(expiresAt.getTime() + 30 * DAY), sentAt: at(0.8), lastReminderAt: at(0.9) };
  assert.deepEqual(dueProposalReminder(extended, new Date(extended.expiresAt.getTime() - 2.5 * DAY)), {
    daysBefore: 3,
  });
});

test("views read as a short summary", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  assert.equal(viewSummary(0, null, now), null);
  assert.equal(viewSummary(1, new Date(now - 2 * 3600_000), now), "Opened once, 2h ago");
  assert.equal(viewSummary(3, new Date(now - 2 * 3600_000), now), "Opened 3x, last 2h ago");
  assert.equal(viewSummary(4, new Date(now - 10_000), now), "Opened 4x, just now");
  assert.equal(timeAgo(new Date(now - 5 * 60_000), now), "5m ago");
  assert.equal(timeAgo(new Date(now - 3 * DAY), now), "3d ago");
  assert.equal(timeAgo(new Date(now - 65 * DAY), now), "2mo ago");
});
