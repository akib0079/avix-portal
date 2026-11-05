import assert from "node:assert/strict";
import { test } from "node:test";
import {
  billableLines,
  contractInvoiced,
  legacyInvoicedUsd,
  type WorkInput,
  type WorkItem,
} from "./billable-lines";

const item = (patch: Partial<WorkItem> & { id: string }): WorkItem => ({
  title: patch.id,
  status: "COMPLETED",
  archived: false,
  pricingType: "FIXED",
  fixedPrice: 100,
  hourlyRate: null,
  onLiveInvoice: false,
  ...patch,
});

const work = (patch: Partial<WorkInput>): WorkInput => ({
  projectName: "Shop",
  billingType: "MILESTONE",
  contractPrice: null,
  contractInvoicedUsd: 0,
  contractMissingUsd: 0,
  items: [],
  unbilledHours: {},
  billedHours: {},
  ...patch,
});

test("completed fixed work is billed once", () => {
  const result = billableLines(
    work({
      items: [
        item({ id: "design", fixedPrice: 300 }),
        item({ id: "build", fixedPrice: 900, onLiveInvoice: true }),
        item({ id: "launch", status: "IN_PROGRESS" }),
        item({ id: "free", pricingType: "NONE" }),
        item({ id: "zero", fixedPrice: 0 }),
      ],
    }),
  );
  assert.deepEqual(result.lines, [
    {
      key: "fixed:design",
      description: "design",
      qty: 1,
      rate: 300,
      source: "milestone-fixed",
      milestoneId: "design",
    },
  ]);
  assert.equal(result.total, 300);
  // Already on a live invoice: counted as billed, not offered again.
  assert.equal(result.billed, 900);
});

test("only hours no live invoice bills become a line", () => {
  const result = billableLines(
    work({
      items: [
        item({ id: "support", pricingType: "HOURLY", hourlyRate: 80, status: "IN_PROGRESS" }),
        item({ id: "tweaks", pricingType: "HOURLY", hourlyRate: 50 }),
        item({ id: "unpriced", pricingType: "HOURLY", hourlyRate: null }),
      ],
      unbilledHours: { support: 2.5, unpriced: 4 },
      billedHours: { support: 10, tweaks: 3 },
    }),
  );
  assert.deepEqual(
    result.lines.map((l) => [l.key, l.description, l.qty, l.rate]),
    [["hours:support", "support — 2.5h", 2.5, 80]],
  );
  assert.equal(result.total, 200);
  assert.equal(result.billed, 10 * 80 + 3 * 50);
});

test("archived work is never billed", () => {
  const result = billableLines(
    work({
      items: [
        item({ id: "old", archived: true }),
        item({ id: "oldHours", archived: true, pricingType: "HOURLY", hourlyRate: 80 }),
      ],
      unbilledHours: { oldHours: 5 },
    }),
  );
  assert.deepEqual(result.lines, []);
  assert.equal(result.total, 0);
});

test("a contract bills what is left of its price", () => {
  const fresh = billableLines(work({ billingType: "CONTRACT", contractPrice: 4500 }));
  assert.deepEqual(
    fresh.lines.map((l) => [l.key, l.description, l.rate]),
    [["contract", "Shop — fixed contract", 4500]],
  );
  assert.equal(fresh.billed, 0);

  const deposit = billableLines(
    work({ billingType: "CONTRACT", contractPrice: 4500, contractInvoicedUsd: 2250 }),
  );
  assert.deepEqual(
    deposit.lines.map((l) => [l.description, l.rate]),
    [["Shop — rest of the fixed contract", 2250]],
  );
  assert.equal(deposit.billed, 2250);

  const done = billableLines(
    work({ billingType: "CONTRACT", contractPrice: 4500, contractInvoicedUsd: 5000 }),
  );
  assert.deepEqual(done.lines, []);
  assert.equal(done.billed, 4500);
  // Milestone pricing doesn't add to a contract.
  assert.deepEqual(
    billableLines(work({ billingType: "CONTRACT", contractPrice: null, items: [item({ id: "x" })] }))
      .lines,
    [],
  );
});

test("a contract bills nothing more while an invoice on it has no USD value", () => {
  // A £4,000 deposit nobody has valued yet: what's left can't be worked out.
  const result = billableLines(
    work({ billingType: "CONTRACT", contractPrice: 10000, contractMissingUsd: 1 }),
  );
  assert.deepEqual(result.lines, []);
  assert.equal(result.total, 0);
});

test("a contract counts drafts and issued invoices, less issued credit notes", () => {
  assert.deepEqual(
    contractInvoiced([
      { usd: 2000, creditNote: false, status: "PAID" },
      { usd: 500, creditNote: false, status: "DRAFT" },
      { usd: 900, creditNote: false, status: "CANCELLED" },
      { usd: 300, creditNote: true, status: "SENT" },
      { usd: 100, creditNote: true, status: "DRAFT" },
      { usd: null, creditNote: false, status: "SENT" },
    ]),
    { usd: 2200, missing: 1 },
  );
});

test("only old invoices that link no work count as maybe billing it already", () => {
  const cutover = new Date("2026-11-02T08:00:00Z");
  const before = new Date("2026-09-10T00:00:00Z");
  const after = new Date("2026-11-03T00:00:00Z");
  const invoice = (patch: Partial<Parameters<typeof legacyInvoicedUsd>[0][number]>) => ({
    usd: 1000,
    creditNote: false,
    status: "PAID",
    createdAt: before,
    linked: false,
    ...patch,
  });
  assert.equal(
    legacyInvoicedUsd(
      [
        invoice({ usd: 3700 }),
        invoice({ usd: 200, status: "SENT" }),
        // The backfill matched its lines to the work.
        invoice({ linked: true }),
        // The new code's: a hand-made invoice bills no tracked work.
        invoice({ createdAt: after }),
        invoice({ status: "CANCELLED" }),
        invoice({ creditNote: true, status: "SENT" }),
        // Worth an unknown number of dollars: nothing to warn about in USD.
        invoice({ usd: null }),
      ],
      cutover,
    ),
    3900,
  );
  assert.equal(legacyInvoicedUsd([], cutover), 0);
});
