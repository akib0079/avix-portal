import assert from "node:assert/strict";
import { test } from "node:test";
import { localDay } from "./calendar-days";

function inZone<T>(zone: string, run: () => T): T {
  const was = process.env.TZ;
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
}

test("localDay is the viewer's day an instant falls on, not the UTC day", () => {
  // 02:00Z on Nov 3: still Nov 2 in New York, already Nov 3 in Dhaka.
  const at = "2026-11-03T02:00:00.000Z";
  assert.equal(inZone("America/New_York", () => localDay(at)), "2026-11-02");
  assert.equal(inZone("Asia/Dhaka", () => localDay(new Date(at))), "2026-11-03");
  // 20:00Z on Nov 2: already Nov 3 in Dhaka.
  assert.equal(inZone("Asia/Dhaka", () => localDay("2026-11-02T20:00:00.000Z")), "2026-11-03");
});
