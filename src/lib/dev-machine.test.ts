import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeveloperPlatform } from "./dev-machine";

test("macOS and Windows are developer machines, the Linux host is not", () => {
  assert.equal(isDeveloperPlatform("darwin"), true);
  assert.equal(isDeveloperPlatform("win32"), true);
  assert.equal(isDeveloperPlatform("linux"), false);
});
