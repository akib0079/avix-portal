import assert from "node:assert/strict";
import { test } from "node:test";
import { emailSendMode } from "./send-mode";

const host = { hasKey: true, nodeEnv: "production", platform: "linux" } as const;

test("the deployed host sends with an https or blank app URL", () => {
  assert.deepEqual(emailSendMode({ ...host, appUrl: "https://admin.avixdigital.com" }), { mode: "send" });
  assert.deepEqual(emailSendMode({ ...host, appUrl: "" }), { mode: "send" });
  assert.deepEqual(emailSendMode({ ...host }), { mode: "send" });
});

test("a dev server or a local app URL host logs instead of sending", () => {
  assert.deepEqual(emailSendMode({ ...host, nodeEnv: "development", appUrl: "https://admin.avixdigital.com" }), { mode: "log" });
  for (const appUrl of ["http://localhost:3000", "http://0.0.0.0:3000", "http://192.168.1.20:3000", "https://portal.localhost"]) {
    assert.deepEqual(emailSendMode({ ...host, appUrl }), { mode: "log" }, appUrl);
  }
});

test("a production run on a developer's computer logs, whatever its app URL", () => {
  for (const appUrl of [undefined, "", "https://abc.ngrok-free.app", "https://admin.avixdigital.com"]) {
    assert.deepEqual(emailSendMode({ ...host, platform: "darwin", appUrl }), { mode: "log" }, String(appUrl));
  }
});

test("plain http on a public host refuses without logging the hint", () => {
  const d = emailSendMode({ ...host, appUrl: "http://admin.avixdigital.com" });
  assert.equal(d.mode, "refuse");
  assert.match(d.mode === "refuse" ? d.reason : "", /https/);
  assert.equal(emailSendMode({ ...host, appUrl: "not a url" }).mode, "refuse");
});

test("a missing key refuses on the host and logs on a developer's computer", () => {
  const d = emailSendMode({ ...host, hasKey: false, appUrl: "https://admin.avixdigital.com" });
  assert.equal(d.mode, "refuse");
  assert.match(d.mode === "refuse" ? d.reason : "", /RESEND_API_KEY/);
  assert.deepEqual(emailSendMode({ ...host, hasKey: false, platform: "darwin" }), { mode: "log" });
});

test("ALLOW_DEV_EMAIL=1 sends from a local run that has a key", () => {
  assert.deepEqual(emailSendMode({ ...host, platform: "darwin", appUrl: "http://localhost:3000", allowDevEmail: "1" }), { mode: "send" });
  assert.deepEqual(emailSendMode({ ...host, nodeEnv: "development", allowDevEmail: "1" }), { mode: "send" });
  assert.deepEqual(emailSendMode({ ...host, hasKey: false, nodeEnv: "development", allowDevEmail: "1" }), { mode: "log" });
});
