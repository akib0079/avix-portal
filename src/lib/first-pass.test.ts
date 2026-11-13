import assert from "node:assert/strict";
import { test } from "node:test";
import { firstPassReader, type FirstPassSlot } from "./first-pass";

test("a missing row is read again; a value is kept", async () => {
  let row: string | null = null;
  let reads = 0;
  const slot: FirstPassSlot = {};
  const firstPassAt = firstPassReader(async () => {
    reads++;
    return row;
  }, slot);

  assert.equal(await firstPassAt(), null);
  assert.equal(await firstPassAt(), null);
  assert.equal(reads, 2);

  row = "2026-11-02T12:00:00.000Z";
  assert.equal((await firstPassAt())?.toISOString(), row);
  assert.equal(reads, 3);
  assert.equal((await firstPassAt())?.toISOString(), row);
  assert.equal((await firstPassAt())?.toISOString(), row);
  assert.equal(reads, 3);
});

test("readers sharing a slot share the value", async () => {
  const slot: FirstPassSlot = {};
  await firstPassReader(async () => "2026-11-02T12:00:00.000Z", slot)();
  const other = firstPassReader(async () => {
    throw new Error("should not read");
  }, slot);
  assert.equal((await other())?.toISOString(), "2026-11-02T12:00:00.000Z");
});

test("each call gets its own Date", async () => {
  const firstPassAt = firstPassReader(async () => "2026-11-02T12:00:00.000Z", {});
  const a = await firstPassAt();
  a?.setFullYear(2000);
  assert.equal((await firstPassAt())?.toISOString(), "2026-11-02T12:00:00.000Z");
});
