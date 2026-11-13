import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldMarkRead } from "./message-read";

const msg = (
  senderRole: "ADMIN" | "CLIENT",
  read: { admin?: string; client?: string } = {},
) => ({
  senderRole,
  readByAdminAt: read.admin ?? null,
  readByClientAt: read.client ?? null,
});

test("an own send gives nothing to mark", () => {
  assert.equal(shouldMarkRead([msg("ADMIN")], "ADMIN"), false);
  assert.equal(shouldMarkRead([msg("CLIENT")], "CLIENT"), false);
});

test("an incoming unread message is marked", () => {
  assert.equal(shouldMarkRead([msg("CLIENT")], "ADMIN"), true);
  assert.equal(shouldMarkRead([msg("ADMIN")], "CLIENT"), true);
});

test("a mixed batch is marked", () => {
  assert.equal(shouldMarkRead([msg("ADMIN"), msg("CLIENT")], "ADMIN"), true);
  assert.equal(shouldMarkRead([msg("CLIENT"), msg("ADMIN")], "CLIENT"), true);
});

test("incoming messages the viewer's side already read are not marked again", () => {
  const at = "2026-01-01T00:00:00.000Z";
  assert.equal(shouldMarkRead([msg("CLIENT", { admin: at })], "ADMIN"), false);
  assert.equal(shouldMarkRead([msg("ADMIN", { client: at })], "CLIENT"), false);
  // The other side's read stamp says nothing about the viewer's.
  assert.equal(shouldMarkRead([msg("CLIENT", { client: at })], "ADMIN"), true);
});

test("an empty batch gives nothing to mark", () => {
  assert.equal(shouldMarkRead([], "ADMIN"), false);
});
