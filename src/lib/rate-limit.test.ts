import assert from "node:assert/strict";
import { test } from "node:test";
import { createRateLimiter } from "./rate-limit";

const MINUTE = 60_000;

test("allows the limit, then refuses with how long to wait", () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 10 * MINUTE });
  const t0 = 1_000_000;
  assert.deepEqual(limiter.take("1.2.3.4", t0), { ok: true });
  assert.deepEqual(limiter.take("1.2.3.4", t0 + 1), { ok: true });
  assert.deepEqual(limiter.take("1.2.3.4", t0 + 2), { ok: true });
  assert.deepEqual(limiter.take("1.2.3.4", t0 + MINUTE), { ok: false, retryAfterMs: 9 * MINUTE });
});

test("the window slides: the oldest attempt leaving lets one more in", () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 10 * MINUTE });
  const t0 = 5_000_000;
  limiter.take("ip", t0);
  limiter.take("ip", t0 + 5 * MINUTE);
  assert.equal(limiter.take("ip", t0 + 9 * MINUTE).ok, false);
  assert.equal(limiter.take("ip", t0 + 10 * MINUTE + 1).ok, true);
  assert.equal(limiter.take("ip", t0 + 10 * MINUTE + 2).ok, false);
});

test("refused attempts don't extend the block", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: MINUTE });
  limiter.take("ip", 0);
  for (let t = 1; t < MINUTE; t += 1000) assert.equal(limiter.take("ip", t).ok, false);
  assert.equal(limiter.take("ip", MINUTE + 1).ok, true);
});

test("keys are counted separately", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: MINUTE });
  assert.equal(limiter.take("a", 0).ok, true);
  assert.equal(limiter.take("a", 1).ok, false);
  assert.equal(limiter.take("b", 2).ok, true);
});

test("past the key cap the least recently used key is forgotten", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: MINUTE, maxKeys: 2 });
  limiter.take("a", 0);
  limiter.take("b", 1);
  limiter.take("a", 2); // refused, but touches "a": "b" is now the oldest
  limiter.take("c", 3); // over the cap: "b" goes
  assert.equal(limiter.take("a", 4).ok, false, "a was kept");
  assert.equal(limiter.take("b", 5).ok, true, "b starts again");
});
