import assert from "node:assert/strict";
import { test } from "node:test";
import { extrasFromRows, type ExtrasRow } from "./work-extras";

function row(over: Partial<ExtrasRow> & { id: string }): ExtrasRow {
  return { comments: [], timeEntries: [], ...over };
}

test("hours are summed in hundredths", () => {
  const extras = extrasFromRows([
    row({ id: "a", timeEntries: [{ hours: 0.1 }, { hours: 0.2 }] }),
    row({ id: "b", timeEntries: [{ hours: 0.15 }, { hours: 0.15 }, { hours: 0.15 }] }),
    // Prisma hands Decimals back; Number() reads them.
    row({ id: "c", timeEntries: [{ hours: { valueOf: () => "1.25" } }, { hours: "0.5" }] }),
  ]);
  assert.equal(extras.hours.get("a"), 0.3);
  assert.equal(extras.hours.get("b"), 0.45);
  assert.equal(extras.hours.get("c"), 1.75);
});

test("an item with no entries, help or billing has no entry", () => {
  const extras = extrasFromRows([row({ id: "a", invoiceItems: [] })]);
  assert.equal(extras.hours.has("a"), false);
  assert.equal(extras.help.has("a"), false);
  assert.equal(extras.billing.has("a"), false);
});

test("help counts split by the side that asked", () => {
  const extras = extrasFromRows([
    row({
      id: "a",
      comments: [{ authorRole: "CLIENT" }, { authorRole: "ADMIN" }, { authorRole: "CLIENT" }],
    }),
    row({ id: "b", comments: [{ authorRole: "ADMIN" }] }),
  ]);
  assert.deepEqual(extras.help.get("a"), { client: 2, team: 1 });
  assert.deepEqual(extras.help.get("b"), { client: 0, team: 1 });
});

test("two lines on one invoice are one billing", () => {
  const inv1 = { id: "inv1", invoiceNumber: "INV-1", status: "SENT" as const };
  const inv2 = { id: "inv2", invoiceNumber: "INV-2", status: "DRAFT" as const };
  const extras = extrasFromRows([
    row({ id: "a", invoiceItems: [{ invoice: inv1 }, { invoice: inv1 }, { invoice: inv2 }] }),
  ]);
  assert.deepEqual(extras.billing.get("a"), [
    { invoiceId: "inv1", invoiceNumber: "INV-1", status: "SENT" },
    { invoiceId: "inv2", invoiceNumber: "INV-2", status: "DRAFT" },
  ]);
});

test("a team-select row (no invoice lines selected) has no billing", () => {
  const extras = extrasFromRows([row({ id: "a", timeEntries: [{ hours: 2 }] })]);
  assert.equal(extras.billing.size, 0);
  assert.equal(extras.hours.get("a"), 2);
});
