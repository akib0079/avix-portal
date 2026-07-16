import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed unsubscribe tokens: `<userId>.<base64url HMAC-SHA256(userId)>`.
 * Lets a client opt out from an email link without logging in, and without a
 * token table. Keyed off BETTER_AUTH_SECRET (already required at runtime).
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

/** Returns the userId when the signature checks out, else null. */
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
