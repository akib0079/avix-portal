import assert from "node:assert/strict";
import { test } from "node:test";
import { liveInvoice, refusedChange, type BilledEntry } from "./time-entry-lock";

function billed(status: string | null): BilledEntry {
  return { invoiceItem: status ? { invoice: { invoiceNumber: "INV-007", status } } : null };
}

test("only an invoice that still counts bills an entry", () => {
  assert.equal(liveInvoice(billed(null)), null);
  assert.equal(liveInvoice(billed("CANCELLED")), null);
  assert.equal(liveInvoice(billed("SENT"))?.invoiceNumber, "INV-007");
  assert.equal(liveInvoice(billed("DRAFT"))?.invoiceNumber, "INV-007");
});

test("a write that matched nothing on a missing entry says so", () => {
  assert.equal(refusedChange("ADMIN", null, "deleting them"), "Time entry not found.");
});

test("an admin is told which invoice holds the hours", () => {
  const message = refusedChange("ADMIN", billed("SENT"), "changing their hours or date");
  assert.match(message, /INV-007/);
  assert.match(message, /before changing their hours or date\.$/);
});

test("staff are told the hours are locked, never by which invoice", () => {
  for (const change of ["changing their hours or date", "deleting them"]) {
    const message = refusedChange("STAFF", billed("PAID"), change);
    assert.doesNotMatch(message, /INV-|invoice/i);
    assert.match(message, /locked/);
  }
  assert.match(refusedChange("STAFF", billed("SENT"), "deleting them"), /need deleting\.$/);
  assert.match(refusedChange("STAFF", billed("SENT"), "changing their hours or date"), /need changing\.$/);
});

test("an entry freed in between asks for a retry, not a lock", () => {
  for (const status of [null, "CANCELLED"]) {
    const message = refusedChange("ADMIN", billed(status), "deleting them");
    assert.doesNotMatch(message, /INV-|locked/);
    assert.match(message, /try again/);
  }
});
