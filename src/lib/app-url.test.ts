import assert from "node:assert/strict";
import { test } from "node:test";
import { appUrl, isLocalAppUrl, isLocalHost } from "./app-url";

test("loopback, wildcard, LAN and dev names are local", () => {
  for (const host of [
    "localhost",
    "app.localhost",
    "0.0.0.0",
    "127.0.0.1",
    "127.8.9.10",
    "[::1]",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.20",
    "169.254.10.10",
    "macbook.local",
    "avix.test",
  ]) {
    assert.equal(isLocalHost(host), true, host);
  }
});

test("public names and addresses are not local", () => {
  for (const host of ["admin.avixdigital.com", "172.32.0.1", "172.15.0.1", "8.8.8.8", "localhost.example.com", "11.0.0.1"]) {
    assert.equal(isLocalHost(host), false, host);
  }
});

test("an app URL is local when its host is, or when it is plain http", () => {
  assert.equal(isLocalAppUrl("http://0.0.0.0:3000"), true);
  assert.equal(isLocalAppUrl("http://192.168.1.20:3000"), true);
  assert.equal(isLocalAppUrl("https://portal.localhost"), true);
  assert.equal(isLocalAppUrl("http://admin.avixdigital.com"), true);
  assert.equal(isLocalAppUrl("https://admin.avixdigital.com"), false);
  // Blank is the deployed fallback, not a local run.
  assert.equal(isLocalAppUrl(""), false);
});

test("appUrl points local runs at production and keeps a real one", () => {
  const saved = process.env.BETTER_AUTH_URL;
  try {
    for (const url of ["", "http://localhost:3000", "http://192.168.1.20:3000", "https://app.localhost"]) {
      process.env.BETTER_AUTH_URL = url;
      assert.equal(appUrl(), "https://admin.avixdigital.com", url);
    }
    process.env.BETTER_AUTH_URL = "https://portal.example.com/";
    assert.equal(appUrl(), "https://portal.example.com");
  } finally {
    if (saved === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = saved;
  }
});
