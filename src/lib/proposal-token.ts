import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signed token on a proposal's public link, without the secret: that is
 * supplied by src/lib/marketing-token.ts, which is server-only. Kept apart so
 * the format can be tested on its own.
 *
 * Version 1 is the original format, `<expiresAtMs>.<sig>` over
 * `proposal:<id>:<expiresAtMs>`, byte for byte, so every link already sitting
 * in an inbox keeps working. Later versions carry the version in the clear
 * and in the signature: `<expiresAtMs>.<version>.<sig>` over
 * `proposal:<id>:<expiresAtMs>:<version>`.
 *
 * That is what makes links revocable without a token table. Proposal.linkVersion
 * is bumped on every resend, extension and withdrawal; an older link still
 * carries a genuine signature, but for a version the row has moved past, so it
 * can be recognised ("this link was replaced") and refused.
 */

export type ProposalTokenClaims = {
  expiresAtMs: number;
  version: number;
};

/** What a genuine link means today, compared with the proposal row. */
export type ProposalLinkState = "valid" | "stale" | "expired";

function subject(proposalId: string, expiresAtMs: number, version: number): string {
  return version === 1
    ? `proposal:${proposalId}:${expiresAtMs}`
    : `proposal:${proposalId}:${expiresAtMs}:${version}`;
}

function sign(secret: string, proposalId: string, expiresAtMs: number, version: number): string {
  return createHmac("sha256", secret)
    .update(subject(proposalId, expiresAtMs, version))
    .digest("base64url");
}

export function mintProposalToken(
  secret: string,
  proposalId: string,
  expiresAtMs: number,
  version: number,
): string {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("A proposal link version is a positive integer.");
  }
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < 0) {
    throw new Error("A proposal link expiry is a whole number of milliseconds.");
  }
  const signature = sign(secret, proposalId, expiresAtMs, version);
  return version === 1
    ? `${expiresAtMs}.${signature}`
    : `${expiresAtMs}.${version}.${signature}`;
}

const DIGITS = /^\d+$/;

/**
 * Checks the signature only and says what the link was minted for, or null
 * when it is forged, garbled or for another proposal. Expiry and version are
 * left to the caller, who has the row to compare them with.
 */
export function readProposalToken(
  secret: string,
  proposalId: string,
  token: string,
): ProposalTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (!DIGITS.test(parts[0])) return null;
  const expiresAtMs = Number(parts[0]);
  if (!Number.isSafeInteger(expiresAtMs)) return null;

  let version = 1;
  if (parts.length === 3) {
    if (!DIGITS.test(parts[1])) return null;
    version = Number(parts[1]);
    // Version 1 is only ever minted in the short form, so a long-form "1" is
    // not something we issued.
    if (!Number.isSafeInteger(version) || version < 2) return null;
  }

  const provided = Buffer.from(parts[parts.length - 1]);
  const expected = Buffer.from(sign(secret, proposalId, expiresAtMs, version));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return { expiresAtMs, version };
}

/**
 * A replaced link is "stale" even when it has also run out: the useful thing
 * to tell the client is that a newer link exists, not that this one is old.
 */
export function proposalLinkState(
  claims: ProposalTokenClaims,
  currentVersion: number,
  nowMs: number,
): ProposalLinkState {
  if (claims.version !== currentVersion) return "stale";
  if (nowMs >= claims.expiresAtMs) return "expired";
  return "valid";
}
