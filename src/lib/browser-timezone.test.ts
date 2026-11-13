import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBrowserTimezone } from "./browser-timezone";

test("parseBrowserTimezone keeps real IANA zones, trimmed", () => {
  assert.equal(parseBrowserTimezone("America/New_York"), "America/New_York");
  assert.equal(parseBrowserTimezone("  Europe/London "), "Europe/London");
  assert.equal(parseBrowserTimezone("UTC"), "UTC");
});

test("parseBrowserTimezone rejects anything else", () => {
  assert.equal(parseBrowserTimezone("Mars/Olympus_Mons"), null);
  assert.equal(parseBrowserTimezone(""), null);
  assert.equal(parseBrowserTimezone("   "), null);
  assert.equal(parseBrowserTimezone(`Europe/${"x".repeat(80)}`), null);
  assert.equal(parseBrowserTimezone(undefined), null);
  assert.equal(parseBrowserTimezone(42), null);
  assert.equal(parseBrowserTimezone({ timezone: "UTC" }), null);
});
