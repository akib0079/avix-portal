import assert from "node:assert/strict";
import { test } from "node:test";
import { clientAddress, keptChain } from "./forwarded-for";

test("without a hop count the first entry is taken, as before", () => {
  assert.equal(clientAddress("203.0.113.7, 10.0.0.1", null, 0), "203.0.113.7");
  assert.equal(clientAddress(null, "198.51.100.2", 0), "198.51.100.2");
  assert.equal(clientAddress("not an address", null, 0), null);
  assert.equal(clientAddress(null, null, 0), null);
});

test("with appending proxies the caller's own entries can't move the address", () => {
  // The caller sent "8.8.8.8"; the CDN appended the real address, LiteSpeed the CDN's.
  const chain = "8.8.8.8, 203.0.113.7, 10.0.0.1";
  assert.equal(clientAddress(chain, null, 2), "203.0.113.7");
  assert.equal(clientAddress("203.0.113.7", null, 1), "203.0.113.7");
  assert.equal(clientAddress("1.1.1.1, 2.2.2.2, 203.0.113.7", null, 1), "203.0.113.7");
  // A chain shorter than the hops falls back to its first entry.
  assert.equal(clientAddress("203.0.113.7", null, 2), "203.0.113.7");
  // A nonsense count is no count.
  assert.equal(clientAddress(chain, null, Number.NaN), "8.8.8.8");
  assert.equal(clientAddress(chain, null, -1), "8.8.8.8");
});

test("the kept chain keeps its end, where the proxies write", () => {
  const padding = "9.9.9.9, ".repeat(100);
  const kept = keptChain(`${padding}203.0.113.7, 10.0.0.1`);
  assert.equal(kept?.length, 512);
  assert.ok(kept?.endsWith("203.0.113.7, 10.0.0.1"));
  assert.equal(keptChain(null), null);
});
