import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreBlock, restoreRefusal } from "./invoice-rules";

const self = "inv-30";

test("a cancelled invoice whose work nobody took comes back", () => {
  assert.equal(restoreBlock(self, []), null);
});

test("live invoices billing its work block the restore and are named", () => {
  const block = restoreBlock(self, [
    { id: "inv-31", invoiceNumber: "INV-031" },
    { id: "inv-32", invoiceNumber: "INV-032" },
  ]);
  assert.deepEqual(block, { rebilledOn: ["INV-031", "INV-032"], hoursMoved: false });
  assert.match(restoreRefusal(block!), /INV-031 and INV-032/);
  assert.match(restoreRefusal(block!), /Cancel those invoices first/);
});

test("an hourly line that lost its hours blocks the restore on its own", () => {
  // The invoice that took the hours is cancelled too, so no live invoice is
  // found: only the invoice itself, for its hourly line with no hours.
  const block = restoreBlock(self, [{ id: self, invoiceNumber: "INV-030" }]);
  assert.deepEqual(block, { rebilledOn: [], hoursMoved: true });
  const message = restoreRefusal(block!);
  assert.match(message, /hours were moved/);
  assert.doesNotMatch(message, /Cancel/);
});

test("moved hours win over naming the invoice to cancel", () => {
  // Cancelling INV-031 wouldn't help: the hours stay off this invoice.
  const block = restoreBlock(self, [
    { id: self, invoiceNumber: "INV-030" },
    { id: "inv-31", invoiceNumber: "INV-031" },
  ]);
  assert.deepEqual(block, { rebilledOn: ["INV-031"], hoursMoved: true });
  assert.doesNotMatch(restoreRefusal(block!), /Cancel INV-031/);
});
