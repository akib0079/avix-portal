import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  mintProposalToken,
  readProposalToken,
  type ProposalTokenClaims,
} from "@/lib/proposal-token";

/**
 * Signed unsubscribe tokens: `<subject>.<base64url HMAC-SHA256(subject)>`.
 * The subject is a user id, or `lead:<id>` for a prospect who isn't a client
 * yet. Lets a recipient opt out from an email link without logging in, and
 * without a token table. Keyed off BETTER_AUTH_SECRET.
 */

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error("BETTER_AUTH_SECRET is not set");
  return value;
}

function sign(userId: string): string {
  return createHmac("sha256", secret()).update(`unsubscribe:${userId}`).digest("base64url");
}

export function createUnsubscribeToken(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

/** Unsubscribe token for a lead (not yet a client). */
export function createLeadUnsubscribeToken(leadId: string): string {
  return createUnsubscribeToken(`lead:${leadId}`);
}

function signMeeting(meetingId: string): string {
  return createHmac("sha256", secret()).update(`meeting-ics:${meetingId}`).digest("base64url");
}

/** Token that lets an email recipient download a meeting's .ics without logging in. */
export function createMeetingIcsToken(meetingId: string): string {
  return signMeeting(meetingId);
}

export function verifyMeetingIcsToken(meetingId: string, token: string): boolean {
  const expected = signMeeting(meetingId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Signed, expiring token for a proposal's public link. Lets a prospect view,
 * accept or decline without an account. The expiry and the link version are
 * bound into the signature, so neither can be tampered with, and bumping
 * Proposal.linkVersion retires every older link (format in proposal-token.ts).
 */
export function createProposalToken(
  proposalId: string,
  expiresAtMs: number,
  linkVersion: number,
): string {
  return mintProposalToken(secret(), proposalId, expiresAtMs, linkVersion);
}

/**
 * The expiry and version a proposal link was minted for, when its signature
 * is genuine; null otherwise. Cheap and database-free, so pages and public
 * actions run it BEFORE touching proposal data, then compare the claims with
 * the row (proposalLinkState).
 */
export function readProposalLink(proposalId: string, token: string): ProposalTokenClaims | null {
  return readProposalToken(secret(), proposalId, token);
}

/** Returns the signed subject (user id, or `lead:<id>`) when valid, else null. */
export function verifyUnsubscribeToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(userId);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}
