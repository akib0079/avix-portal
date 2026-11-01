import assert from "node:assert/strict";
import { test } from "node:test";
import {
  balanceDue,
  creditedTotal,
  invoiceTotals,
  settleStatus,
  unsettledStatus,
} from "./invoice-totals";
import {
  canDeleteInvoice,
  draftBlocker,
  isReceivable,
  paymentBlocker,
  sendBlocker,
} from "./invoice-rules";

test("paid in full is PAID, part paid is PARTIALLY_PAID", () => {
  assert.equal(settleStatus({ total: 500, paid: 500, current: "SENT" }), "PAID");
  assert.equal(settleStatus({ total: 500, paid: 600, current: "SENT" }), "PAID");
  assert.equal(settleStatus({ total: 500, paid: 200, current: "SENT" }), "PARTIALLY_PAID");
  assert.equal(settleStatus({ total: 500, paid: 200, current: "IN_REVIEW" }), "PARTIALLY_PAID");
  // Cents don't leave a sliver owing: 0.1 + 0.2 is not quite 0.3 in floats.
  assert.equal(settleStatus({ total: 0.3, paid: 0.1 + 0.2, current: "SENT" }), "PAID");
});

test("with no money in, the status it had stays — it is never forced to SENT", () => {
  for (const current of ["ASSIGNED", "SENT", "IN_REVIEW"] as const) {
    assert.equal(settleStatus({ total: 500, paid: 0, current }), current);
  }
});

test("money never moves a draft or a cancelled invoice", () => {
  assert.equal(settleStatus({ total: 500, paid: 500, current: "CANCELLED" }), "CANCELLED");
  assert.equal(settleStatus({ total: 500, paid: 0, current: "CANCELLED" }), "CANCELLED");
  assert.equal(settleStatus({ total: 500, paid: 0, current: "DRAFT" }), "DRAFT");
});

test("credit notes count toward settling but don't make an invoice part paid", () => {
  assert.equal(settleStatus({ total: 500, paid: 0, credited: 500, current: "SENT" }), "PAID");
  assert.equal(settleStatus({ total: 500, paid: 300, credited: 200, current: "SENT" }), "PAID");
  assert.equal(settleStatus({ total: 500, paid: 0, credited: 100, current: "SENT" }), "SENT");
  assert.equal(
    settleStatus({ total: 500, paid: 100, credited: 100, current: "SENT" }),
    "PARTIALLY_PAID",
  );
});

test("a paid status with no money behind it steps back to the fallback", () => {
  assert.equal(settleStatus({ total: 500, paid: 0, current: "PAID", fallback: "IN_REVIEW" }), "IN_REVIEW");
  assert.equal(
    settleStatus({ total: 500, paid: 0, current: "PARTIALLY_PAID", fallback: "ASSIGNED" }),
    "ASSIGNED",
  );
  assert.equal(settleStatus({ total: 500, paid: 0, current: "PAID" }), "SENT");
  // An amount raised past what was paid turns PAID back into part paid.
  assert.equal(settleStatus({ total: 800, paid: 500, current: "PAID" }), "PARTIALLY_PAID");
});

test("a zero total with nothing paid is not PAID", () => {
  assert.equal(settleStatus({ total: 0, paid: 0, current: "SENT" }), "SENT");
});

test("the fallback follows what happened to the invoice", () => {
  assert.equal(unsettledStatus({ sentAt: null, paymentClaimedAt: null }), "ASSIGNED");
  assert.equal(unsettledStatus({ sentAt: new Date(), paymentClaimedAt: null }), "SENT");
  assert.equal(unsettledStatus({ sentAt: new Date(), paymentClaimedAt: new Date() }), "IN_REVIEW");
});

test("the balance subtracts payments and credits and never goes negative", () => {
  assert.equal(balanceDue(500, 200), 300);
  assert.equal(balanceDue(500, 200, 100), 200);
  assert.equal(balanceDue(500, 600), 0);
});

test("cancelled and drafted credit notes credit nothing", () => {
  assert.equal(
    creditedTotal([
      { amount: 100, status: "SENT" },
      { amount: 50, status: "CANCELLED" },
      { amount: 25, status: "DRAFT" },
      { amount: "10.50", status: "PAID" },
    ]),
    110.5,
  );
});

test("totals still apply the discount before the tax", () => {
  const totals = invoiceTotals({ items: [{ qty: 2, rate: 150 }], discount: 20, taxRate: 15 });
  assert.deepEqual(totals, { subtotal: 300, discount: 20, taxable: 280, taxAmount: 42, total: 322 });
});

test("drafts, cancelled invoices and credit notes take no payments", () => {
  assert.equal(paymentBlocker({ status: "SENT" }), null);
  assert.equal(paymentBlocker({ status: "PARTIALLY_PAID" }), null);
  assert.ok(paymentBlocker({ status: "DRAFT" }));
  assert.ok(paymentBlocker({ status: "CANCELLED" }));
  assert.ok(paymentBlocker({ status: "SENT", creditNoteForId: "inv_1" }));
});

test("cancelled invoices and credit notes aren't emailed", () => {
  assert.equal(sendBlocker({ status: "DRAFT" }), null);
  assert.equal(sendBlocker({ status: "PAID" }), null);
  assert.ok(sendBlocker({ status: "CANCELLED" }));
  assert.ok(sendBlocker({ status: "SENT", creditNoteForId: "inv_1" }));
});

test("only an untouched, unsent draft can be deleted", () => {
  const fresh = {
    status: "DRAFT" as const,
    sentAt: null,
    amountPaid: 0,
    paymentCount: 0,
    creditNoteCount: 0,
  };
  assert.equal(canDeleteInvoice(fresh), true);
  assert.equal(canDeleteInvoice({ ...fresh, status: "ASSIGNED" }), true);
  assert.equal(canDeleteInvoice({ ...fresh, status: "SENT" }), false);
  assert.equal(canDeleteInvoice({ ...fresh, sentAt: new Date() }), false);
  assert.equal(canDeleteInvoice({ ...fresh, paymentCount: 1 }), false);
  assert.equal(canDeleteInvoice({ ...fresh, amountPaid: 450 }), false);
  assert.equal(canDeleteInvoice({ ...fresh, creditNoteCount: 1 }), false);
});

test("an invoice can go back to draft only before the client has had it", () => {
  assert.equal(draftBlocker({ sentAt: null, amountPaid: 0 }), null);
  assert.ok(draftBlocker({ sentAt: new Date(), amountPaid: 0 }));
  assert.ok(draftBlocker({ sentAt: null, amountPaid: 10 }));
});

test("drafts, settled and void invoices and credit notes aren't receivables", () => {
  assert.equal(isReceivable({ status: "SENT" }), true);
  assert.equal(isReceivable({ status: "ASSIGNED" }), true);
  assert.equal(isReceivable({ status: "IN_REVIEW" }), true);
  assert.equal(isReceivable({ status: "PARTIALLY_PAID" }), true);
  assert.equal(isReceivable({ status: "DRAFT" }), false);
  assert.equal(isReceivable({ status: "PAID" }), false);
  assert.equal(isReceivable({ status: "CANCELLED" }), false);
  assert.equal(isReceivable({ status: "SENT", creditNoteForId: "inv_1" }), false);
});
