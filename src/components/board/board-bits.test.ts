import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useToday } from "./board-bits";

function Today({ renderedAt }: { renderedAt: number }) {
  return createElement("span", null, useToday(renderedAt));
}

test("the server renders today as the UTC day of renderedAt, the same day hydration reads", () => {
  // 02:00Z on Nov 3: still Nov 2 in New York, already Nov 3 in Dhaka.
  const renderedAt = Date.parse("2026-11-03T02:00:00.000Z");
  const was = process.env.TZ;
  try {
    for (const zone of ["America/New_York", "Asia/Dhaka", "UTC"]) {
      process.env.TZ = zone;
      assert.equal(renderToString(createElement(Today, { renderedAt })), "<span>2026-11-03</span>", zone);
    }
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
});
