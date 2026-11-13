import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkItemDetail } from "@/lib/board";
import { seedToTake } from "./detail-seed";

const promise = Promise.resolve<WorkItemDetail | null>(null);
const seed = { itemId: "a", promise };

test("a drawer takes the page's seed for its own item while nothing is cached", () => {
  assert.equal(seedToTake(seed, "a", false, new Set()), promise);
});

test("no seed for another item, a cached item, or a seed already taken", () => {
  assert.equal(seedToTake(null, "a", false, new Set()), null);
  assert.equal(seedToTake(seed, "b", false, new Set()), null);
  assert.equal(seedToTake(seed, "a", true, new Set()), null);
  // Closed before the seed landed and opened again: fetch, don't reuse it.
  assert.equal(seedToTake(seed, "a", false, new Set([promise])), null);
});
