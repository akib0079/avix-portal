import { test } from "node:test";
import assert from "node:assert/strict";
import { clientMoney, type ClientMoneyInvoice } from "./client-money";

const now = new Date("2026-11-10T12:00:00Z");
const past = new Date("2026-11-01T00:00:00Z");
const future = new Date("2026-12-01T00:00:00Z");

function inv(over: Partial<ClientMoneyInvoice> = {}): ClientMoneyInvoice {
  return {
    amount: 1000,
    amountPaid: 0,
    currency: "USD",
    amountUsd: null,
    status: "SENT",
    dueDate: future,
    credited: 0,
    ...over,
  };
}

test("currencies are totalled at each invoice's USD value, never at face value", () => {
  const money = clientMoney(
    [inv(), inv({ amount: 2000, currency: "EUR", amountUsd: 2200, amountPaid: 1000, status: "PARTIALLY_PAID" })],
    now,
  );
  assert.deepEqual(money, { billed: 3200, collected: 1100, outstanding: 2100, overdue: 0, unconverted: 0 });
});

test("an invoice with no USD value yet is left out and counted", () => {
  const money = clientMoney([inv(), inv({ currency: "EUR" })], now);
  assert.equal(money.billed, 1000);
  assert.equal(money.unconverted, 1);
});

test("credit notes come off billed, outstanding and overdue", () => {
  const money = clientMoney([inv({ credited: 300, dueDate: past })], now);
  assert.deepEqual(money, { billed: 700, collected: 0, outstanding: 700, overdue: 700, unconverted: 0 });
});

test("a past-due invoice credited in full owes nothing, whatever its status", () => {
  const settled = clientMoney([inv({ status: "PAID", credited: 1000, dueDate: past })], now);
  assert.equal(settled.outstanding, 0);
  assert.equal(settled.overdue, 0);
  // Credited before re-settling existed: still SENT, still nothing owed.
  const legacy = clientMoney([inv({ credited: 1000, dueDate: past })], now);
  assert.equal(legacy.overdue, 0);
});

test("an overpayment on one invoice doesn't pay another", () => {
  const money = clientMoney([inv({ amountPaid: 1200, status: "PAID" }), inv({ dueDate: past })], now);
  assert.equal(money.outstanding, 1000);
  assert.equal(money.overdue, 1000);
});

test("an invoice for nothing is $0, not unconverted", () => {
  const money = clientMoney([inv(), inv({ amount: 0 }), inv({ amount: 0, currency: "EUR" })], now);
  assert.deepEqual(money, { billed: 1000, collected: 0, outstanding: 1000, overdue: 0, unconverted: 0 });
});
