import { createHash } from "node:crypto";
import type { FirstInvoicePromise } from "./proposal-rules";

/**
 * Exactly what a client signs, in a form that hashes the same way every time.
 *
 * A signature is only worth something if it can later be shown to belong to
 * one specific document. So the server never signs what the browser says it
 * saw: it rebuilds the proposal from the database (scope, money, terms,
 * recipient, dates), serialises it canonically and takes its SHA-256. The
 * public page renders the same hash beside the sign button and posts it back,
 * so a proposal edited after the page loaded can't be signed blind.
 *
 * Canonical means: keys sorted at every level, money as fixed two-decimal
 * strings ("1500.00", never 1500 or 1500.0), integers as plain numbers and
 * nothing else numeric, line endings normalised. Postgres jsonb reorders keys
 * and a Decimal prints however it likes, so the stored snapshot can be
 * re-hashed years later and still match.
 *
 * Changing anything here changes every hash it produces. Don't: add a new
 * SNAPSHOT_VERSION with its own builder, and keep this one for the
 * signatures already made with it.
 *
 * Dependency-free apart from node:crypto, so the tests can exercise it.
 */

export const SNAPSHOT_VERSION = 1;

/** Something that prints as a decimal amount: a number, a string, or a Prisma Decimal. */
export type MoneyLike = number | string | { toString(): string };

export type SnapshotFirstInvoice = {
  kind: "invoice" | "deposit";
  amount: string;
  currency: string;
  /** The deposit percentage, for a deposit; null for an attached invoice. */
  percent: number | null;
};

export type ProposalSnapshot = {
  snapshotVersion: number;
  proposalId: string;
  /**
   * The proposal's link version: bumped by every resend, extension and
   * withdrawal, so it names which sending of the proposal was signed.
   */
  linkVersion: number;
  title: string;
  intro: string | null;
  terms: string | null;
  currency: string;
  items: { description: string; amount: string }[];
  total: string;
  depositPercent: number;
  /** What the client was told they would be invoiced first (firstInvoicePromise). */
  firstInvoice: SnapshotFirstInvoice | null;
  timelineWeeks: number | null;
  recipient: { name: string; email: string | null; company: string | null };
  agency: { name: string };
  sentAt: string | null;
  expiresAt: string | null;
};

export type SnapshotInput = {
  proposalId: string;
  linkVersion: number;
  title: string;
  intro: string | null;
  terms: string | null;
  currency: string;
  /** In any order: they are put in the proposal's own order (sortOrder, then id). */
  items: { id: string; description: string; amount: MoneyLike; sortOrder: number }[];
  depositPercent: number;
  firstInvoice: FirstInvoicePromise;
  timelineWeeks: number | null;
  recipient: { name: string; email: string | null; company: string | null };
  agencyName: string;
  sentAt: Date | string | null;
  expiresAt: Date | string | null;
};

// ---------- Money ----------

/**
 * An amount in whole cents, exactly. Strings and Decimals are read digit by
 * digit, never through a float; a number is first printed with six decimals,
 * which absorbs float noise (0.1 + 0.2, 1.005) before rounding half up.
 */
export function toCents(value: MoneyLike): number {
  const text = typeof value === "number" ? value.toFixed(6) : String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Not an amount: ${text}`);
  const [, sign, whole, fraction = ""] = match;
  const digits = `${fraction}000`.slice(0, 3);
  let cents = Number(whole) * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) throw new Error(`Amount out of range: ${text}`);
  return sign && cents !== 0 ? -cents : cents;
}

/** Whole cents as "1500.00". */
export function centsToString(cents: number): string {
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `-${text}` : text;
}

/** Any amount as a fixed two-decimal string. */
export function moneyString(value: MoneyLike): string {
  return centsToString(toCents(value));
}

// ---------- Canonical form ----------

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * JSON with every object's keys sorted and nothing ambiguous allowed in:
 * fractional numbers are refused (money travels as strings), as are dates,
 * class instances, NaN and Infinity. Undefined properties are left out, as
 * JSON.stringify does, so an optional field that is absent hashes like one
 * that was never there.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new Error(`Only whole numbers are hashed; write ${value} as a string`);
      }
      return String(value === 0 ? 0 : value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      if (!isPlainObject(value)) throw new Error("Only plain objects are hashed");
      const keys = Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
    }
    default:
      throw new Error(`Can't hash a ${typeof value}`);
  }
}

/** SHA-256 hex of the canonical form. */
export function snapshotHash(snapshot: ProposalSnapshot): string {
  return createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}

/**
 * Whether a stored snapshot still hashes to the hash stored beside it. Anything
 * that can't be hashed (a hand-edited row, a newer format) is simply false.
 */
export function snapshotMatches(snapshot: unknown, documentHash: string): boolean {
  try {
    return snapshotHash(snapshot as ProposalSnapshot) === documentHash;
  } catch {
    return false;
  }
}

// ---------- Building ----------

/** \r\n and lone \r become \n, so the same text typed on Windows hashes the same. */
function text(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function optionalText(value: string | null | undefined): string | null {
  return value == null || value === "" ? null : text(value);
}

function isoOrNull(value: Date | string | null): string | null {
  if (value == null) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error(`Not a date: ${String(value)}`);
  return date.toISOString();
}

/** Builds the snapshot a signature is made over. Pure: same input, same snapshot. */
export function buildProposalSnapshot(input: SnapshotInput): ProposalSnapshot {
  const items = [...input.items]
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((item) => ({ description: text(item.description), amount: moneyString(item.amount) }));
  const totalCents = items.reduce((sum, item) => sum + toCents(item.amount), 0);
  const first = input.firstInvoice;

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    proposalId: input.proposalId,
    linkVersion: input.linkVersion,
    title: text(input.title),
    intro: optionalText(input.intro),
    terms: optionalText(input.terms),
    currency: input.currency,
    items,
    total: centsToString(totalCents),
    depositPercent: input.depositPercent,
    firstInvoice: first
      ? {
          kind: first.kind,
          amount: moneyString(first.amount),
          currency: first.currency,
          percent: first.kind === "deposit" ? first.percent : null,
        }
      : null,
    timelineWeeks: input.timelineWeeks,
    recipient: {
      name: text(input.recipient.name),
      email: input.recipient.email ? input.recipient.email.toLowerCase() : null,
      company: optionalText(input.recipient.company),
    },
    agency: { name: input.agencyName },
    sentAt: isoOrNull(input.sentAt),
    expiresAt: isoOrNull(input.expiresAt),
  };
}

// ---------- Reading back ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MONEY = /^-?\d+\.\d{2}$/;

/**
 * A stored snapshot, checked for the shape this version writes, or null. The
 * page and the PDF render from it, so a malformed row must never get as far
 * as a crash halfway through a document.
 */
export function parseSnapshot(value: unknown): ProposalSnapshot | null {
  if (!isRecord(value) || value.snapshotVersion !== SNAPSHOT_VERSION) return null;
  const str = (v: unknown) => typeof v === "string";
  const strOrNull = (v: unknown) => v === null || typeof v === "string";
  const int = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v);
  const recipient = value.recipient;
  const agency = value.agency;
  const first = value.firstInvoice;
  const ok =
    str(value.proposalId) &&
    int(value.linkVersion) &&
    str(value.title) &&
    strOrNull(value.intro) &&
    strOrNull(value.terms) &&
    str(value.currency) &&
    Array.isArray(value.items) &&
    value.items.every(
      (i) => isRecord(i) && str(i.description) && typeof i.amount === "string" && MONEY.test(i.amount),
    ) &&
    typeof value.total === "string" &&
    MONEY.test(value.total) &&
    int(value.depositPercent) &&
    (first === null ||
      (isRecord(first) &&
        (first.kind === "invoice" || first.kind === "deposit") &&
        typeof first.amount === "string" &&
        MONEY.test(first.amount) &&
        str(first.currency) &&
        (first.percent === null || int(first.percent)))) &&
    (value.timelineWeeks === null || int(value.timelineWeeks)) &&
    isRecord(recipient) &&
    str(recipient.name) &&
    strOrNull(recipient.email) &&
    strOrNull(recipient.company) &&
    isRecord(agency) &&
    str(agency.name) &&
    strOrNull(value.sentAt) &&
    strOrNull(value.expiresAt);
  return ok ? (value as unknown as ProposalSnapshot) : null;
}

/** A snapshot's money back as a number, for display. */
export function snapshotAmount(value: string): number {
  return toCents(value) / 100;
}
