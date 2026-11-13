import assert from "node:assert/strict";
import { test } from "node:test";
import { itemWrites, lineChanged } from "./invoice-items";

test("an edit keeps the lines that bill tracked work, and replaces the rest", () => {
  const linked = new Set(["billed-hours", "billed-fixed"]);
  const result = itemWrites(
    [
      { id: "plain", description: "Hosting" },
      { id: "billed-fixed", description: "Design (renamed)" },
      { description: "A new line" },
      { id: "billed-hours", description: "Support — 3h" },
    ],
    linked,
  );
  assert.deepEqual(
    result.update.map((u) => [u.id, u.index]),
    [
      ["billed-fixed", 1],
      ["billed-hours", 3],
    ],
  );
  assert.deepEqual(
    result.create.map((c) => [c.item.description, c.index]),
    [
      ["Hosting", 0],
      ["A new line", 2],
    ],
  );
  assert.deepEqual(result.keepIds.sort(), ["billed-fixed", "billed-hours"]);
});

test("ids the invoice doesn't own, and repeats, are new lines", () => {
  const result = itemWrites(
    [
      { id: "someone-elses", description: "x" },
      { id: "mine", description: "first" },
      { id: "mine", description: "pasted twice" },
    ],
    new Set(["mine"]),
  );
  assert.deepEqual(result.keepIds, ["mine"]);
  assert.equal(result.update.length, 1);
  assert.equal(result.create.length, 2);
});

test("a linked line left out of the edit is not kept, so its work is freed", () => {
  const result = itemWrites<{ id?: string; description: string }>(
    [{ description: "Only line" }],
    new Set(["billed"]),
  );
  assert.deepEqual(result.keepIds, []);
  assert.equal(result.create.length, 1);
});

test("a kept line is written only when the edit changes it", () => {
  const doc = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Design", marks: [{ type: "bold" }] }] }],
  };
  // As jsonb hands it back: the same document, its keys in another order.
  const stored = {
    content: [{ content: [{ marks: [{ type: "bold" }], text: "Design", type: "text" }], type: "paragraph" }],
    type: "doc",
  };
  const saved = { description: "Design", descriptionRich: stored, qty: "2.00", rate: "150.00", sortOrder: 1 };
  const row = { description: "Design", descriptionRich: doc, qty: 2, rate: 150, sortOrder: 1 };
  assert.equal(lineChanged(saved, row), false);

  assert.equal(lineChanged(saved, { ...row, description: "Design and build" }), true);
  assert.equal(lineChanged(saved, { ...row, rate: 150.5 }), true);
  assert.equal(lineChanged(saved, { ...row, qty: 3 }), true);
  // A line above it was removed, so it moved up.
  assert.equal(lineChanged(saved, { ...row, sortOrder: 0 }), true);
  assert.equal(lineChanged(saved, { ...row, descriptionRich: { ...doc, content: [] } }), true);
});

test("no formatting reads the same whether it is null or missing", () => {
  const saved = { description: "Hosting", descriptionRich: null, qty: 1, rate: 40, sortOrder: 0 };
  assert.equal(lineChanged(saved, { description: "Hosting", qty: 1, rate: 40, sortOrder: 0 }), false);
});
