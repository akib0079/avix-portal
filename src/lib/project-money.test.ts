import assert from "node:assert/strict";
import { test } from "node:test";
import { projectMoneyTotals, type ProjectInvoice } from "./project-money";

const invoice = (patch: Partial<ProjectInvoice>): ProjectInvoice => ({
  amount: 1000,
  amountPaid: 0,
  status: "SENT",
  currency: "USD",
  amountUsd: 1000,
  creditNoteForId: null,
  credited: 0,
  ...patch,
});

test("a credit note comes off the invoice it credits, never adds to it", () => {
  // Credited in full: the invoice is settled and the note isn't a bill.
  assert.deepEqual(
    projectMoneyTotals([
      invoice({ status: "PAID", credited: 1000 }),
      invoice({ creditNoteForId: "inv" }),
    ]),
    { invoiced: 0, paid: 0, outstanding: 0, count: 1, missingUsd: 0 },
  );
  // Part credited: $700 left to pay, not $1,300.
  assert.equal(projectMoneyTotals([invoice({ credited: 300 })]).outstanding, 700);
  // A refund credit on a paid invoice owes nothing and goes no lower.
  assert.deepEqual(
    projectMoneyTotals([invoice({ status: "PAID", amountPaid: 1000, credited: 200 })]),
    { invoiced: 800, paid: 1000, outstanding: 0, count: 1, missingUsd: 0 },
  );
});

test("other currencies count at their USD value, or are left out and counted", () => {
  assert.deepEqual(
    projectMoneyTotals([
      // €1,000 worth $1,080, half paid.
      invoice({ currency: "EUR", amountUsd: 1080, amountPaid: 500 }),
      invoice({ currency: "GBP", amountUsd: null }),
      invoice({ amountUsd: null }),
    ]),
    { invoiced: 2080, paid: 540, outstanding: 1540, count: 3, missingUsd: 1 },
  );
});

test("drafts are invoiced but not owed; cancelled invoices don't count", () => {
  assert.deepEqual(
    projectMoneyTotals([invoice({ status: "DRAFT" }), invoice({ status: "CANCELLED" })]),
    { invoiced: 1000, paid: 0, outstanding: 0, count: 1, missingUsd: 0 },
  );
});
