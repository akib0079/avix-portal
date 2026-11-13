import assert from "node:assert/strict";
import { test } from "node:test";
import { newestCapped } from "./action-center-lists";

const at = (id: string, minute: number) => ({ id, createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)) });

test("newestCapped keeps the overall newest across projects, newest first", () => {
  // Two projects' lists, each newest first and read cap + 1 long.
  const a = [at("a3", 30), at("a2", 20), at("a1", 10)];
  const b = [at("b3", 35), at("b2", 25), at("b1", 5)];
  const { list, more } = newestCapped([...a, ...b], 2);
  assert.deepEqual(
    list.map((r) => r.id),
    ["b3", "a3"],
  );
  assert.equal(more, true);
});

test("newestCapped says more only past the cap", () => {
  const rows = [at("x", 1), at("y", 2)];
  assert.equal(newestCapped(rows, 2).more, false);
  assert.equal(newestCapped([...rows, at("z", 3)], 2).more, true);
  assert.deepEqual(
    newestCapped([...rows, at("z", 3)], 2).list.map((r) => r.id),
    ["z", "y"],
  );
});

test("newestCapped leaves its input alone", () => {
  const rows = [at("old", 1), at("new", 2)];
  newestCapped(rows, 1);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["old", "new"],
  );
});
