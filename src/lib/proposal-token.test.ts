import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { mintProposalToken, proposalLinkState, readProposalToken } from "./proposal-token";

const SECRET = "test-secret";
const ID = "cmproposal123";
const EXP = 1_800_000_000_000;

test("version 1 links are minted exactly as before, so sent links keep working", () => {
  const legacy = `${EXP}.${createHmac("sha256", SECRET).update(`proposal:${ID}:${EXP}`).digest("base64url")}`;
  assert.equal(mintProposalToken(SECRET, ID, EXP, 1), legacy);
  assert.deepEqual(readProposalToken(SECRET, ID, legacy), { expiresAtMs: EXP, version: 1 });
});

test("later versions carry the version and round-trip", () => {
  const token = mintProposalToken(SECRET, ID, EXP, 3);
  assert.equal(token.split(".").length, 3);
  assert.deepEqual(readProposalToken(SECRET, ID, token), { expiresAtMs: EXP, version: 3 });
});

test("a tampered expiry, version, proposal or secret is rejected", () => {
  const token = mintProposalToken(SECRET, ID, EXP, 2);
  const [, version, sig] = token.split(".");
  assert.equal(readProposalToken(SECRET, ID, `${EXP + 1}.${version}.${sig}`), null);
  assert.equal(readProposalToken(SECRET, ID, `${EXP}.3.${sig}`), null);
  assert.equal(readProposalToken(SECRET, "another-proposal", token), null);
  assert.equal(readProposalToken("other-secret", ID, token), null);
  // Dropping the version must not turn it into a valid version-1 link.
  assert.equal(readProposalToken(SECRET, ID, `${EXP}.${sig}`), null);
});

test("garbage and the never-issued long form of version 1 are rejected", () => {
  const v1sig = mintProposalToken(SECRET, ID, EXP, 1).split(".")[1];
  for (const bad of ["", ".", "abc", `${EXP}`, `${EXP}.1.${v1sig}`, `-5.${v1sig}`, `1e12.${v1sig}`, `${EXP}.x.y.z`]) {
    assert.equal(readProposalToken(SECRET, ID, bad), null, bad);
  }
  assert.throws(() => mintProposalToken(SECRET, ID, EXP, 0));
});

test("a bumped linkVersion retires older links, even ones that have also run out", () => {
  const claims = readProposalToken(SECRET, ID, mintProposalToken(SECRET, ID, EXP, 1))!;
  assert.equal(proposalLinkState(claims, 1, EXP - 1), "valid");
  assert.equal(proposalLinkState(claims, 1, EXP), "expired");
  assert.equal(proposalLinkState(claims, 2, EXP - 1), "stale");
  assert.equal(proposalLinkState(claims, 2, EXP + 1), "stale");
});
