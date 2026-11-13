import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate } from "./format";

test("a day key shows its own day in every time zone", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ["America/New_York", "UTC", "Asia/Dhaka"]) {
      process.env.TZ = zone;
      assert.equal(formatDate("2026-11-02"), "Nov 2, 2026", zone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("a timestamp still shows the viewer's local day", () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    assert.equal(formatDate("2026-11-02T03:00:00Z"), "Nov 1, 2026");
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("empty dates read as a dash", () => {
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate(""), "—");
});
