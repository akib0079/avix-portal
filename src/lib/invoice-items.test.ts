import assert from "node:assert/strict";
import { test } from "node:test";
import { itemWrites } from "./invoice-items";

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
