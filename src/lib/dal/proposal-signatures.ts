import "server-only";
import {
  documentFromSnapshot,
  parseSnapshot,
  snapshotMatches,
  type ProposalDocumentView,
} from "@/lib/proposal-snapshot";
import { AGENCY_NAME, browserSummary } from "@/lib/signature-rules";
import { pngDataUri } from "@/lib/signature-png";
import type { Prisma, ProposalEventType, SignatureMethod } from "@prisma/client";

/**
 * Reading signatures back: the certificate the client, the portal, the admin
 * and the PDF all show, built from the evidence row and the proposal's audit
 * events. Nothing here reads or authorises: the callers' queries spread
 * these selects into their own statement (one round trip), and they have
 * already authorised (a valid link, the client's own session, an admin).
 */

/** The columns a certificate or a signed PDF is made from. */
export const SIGNATURE_SELECT = {
  id: true,
  method: true,
  signerName: true,
  signerEmail: true,
  signerTitle: true,
  signerCompany: true,
  imagePng: true,
  typedFont: true,
  consentText: true,
  consentVersion: true,
  documentHash: true,
  snapshot: true,
  ipAddress: true,
  userAgent: true,
  signedAt: true,
  pdfPath: true,
  pdfSha256: true,
} satisfies Prisma.ProposalSignatureSelect;

export type SignatureRow = Prisma.ProposalSignatureGetPayload<{ select: typeof SIGNATURE_SELECT }>;

/** The client's signature on a proposal, newest first (there is only ever one). */
export const CLIENT_SIGNATURE = {
  where: { role: "CLIENT" },
  orderBy: { signedAt: "desc" },
  take: 1,
  select: SIGNATURE_SELECT,
} satisfies Prisma.Proposal$signaturesArgs;

/**
 * The events a certificate's audit trail is made of. Views are left out (a
 * proposal can be opened hundreds of times); the first one is
 * Proposal.firstViewedAt, written by the same statement as its event.
 */
export const AUDIT_EVENT_TYPES = ["SENT", "RESENT", "EXTENDED", "SIGNED"] as const satisfies readonly ProposalEventType[];

export const AUDIT_EVENTS = {
  where: { type: { in: [...AUDIT_EVENT_TYPES] } },
  orderBy: { createdAt: "asc" },
  take: 50,
  select: { id: true, type: true, createdAt: true, meta: true },
} satisfies Prisma.Proposal$eventsArgs;

type AuditEventRow = { id: string; type: ProposalEventType; createdAt: Date; meta: Prisma.JsonValue };

export type CertificateEvent = { key: string; at: string; label: string; detail: string | null };

/** Everything a certificate shows, serialised for the page (and the browser). */
export type SignatureCertificateView = {
  id: string;
  method: SignatureMethod;
  signerName: string;
  signerEmail: string;
  signerTitle: string | null;
  signerCompany: string | null;
  /** A drawn signature, as a PNG data URI. */
  imageDataUri: string | null;
  consentText: string;
  consentVersion: string;
  documentHash: string;
  /** The stored snapshot still hashes to documentHash. */
  hashVerified: boolean;
  signedAt: string;
  /** The zone the signer's browser reported when signing, if it did. */
  signerTimeZone: string | null;
  ipAddress: string | null;
  browser: string | null;
  agencyName: string;
  timeline: CertificateEvent[];
};

function metaOf(meta: Prisma.JsonValue): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
}

function metaString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === "string" && value ? value : null;
}

function utcDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The SIGNED event that belongs to this signature (older events don't name one). */
function signedEventOf(signatureId: string, events: AuditEventRow[]): AuditEventRow | null {
  const signed = events.filter((e) => e.type === "SIGNED");
  return signed.find((e) => metaOf(e.meta).signatureId === signatureId) ?? signed.at(-1) ?? null;
}

function timelineOf(
  signature: SignatureRow,
  events: AuditEventRow[],
  firstViewedAt: Date | null,
): CertificateEvent[] {
  const rows: CertificateEvent[] = [];
  for (const e of events) {
    const at = e.createdAt.toISOString();
    if (e.type === "SENT") rows.push({ key: e.id, at, label: `Sent by ${AGENCY_NAME}`, detail: null });
    if (e.type === "RESENT") rows.push({ key: e.id, at, label: "Sent again with a new link", detail: null });
    if (e.type === "EXTENDED") {
      const until = metaString(metaOf(e.meta), "expiresAt");
      rows.push({ key: e.id, at, label: "Extended", detail: until ? `open until ${utcDay(until)}` : null });
    }
  }
  if (firstViewedAt) {
    rows.push({ key: "first-view", at: firstViewedAt.toISOString(), label: "First opened by the recipient", detail: null });
  }
  const recorded = signature.method === "ADMIN_RECORDED";
  rows.push({
    key: signature.id,
    at: signature.signedAt.toISOString(),
    label: recorded
      ? `Recorded by ${AGENCY_NAME} on behalf of ${signature.signerName}`
      : `Signed by ${signature.signerName}`,
    detail: [
      signature.method === "DRAWN" ? "drawn signature" : signature.method === "TYPED" ? "typed signature" : null,
      signature.ipAddress ? `IP ${signature.ipAddress}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || null,
  });
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

export function toCertificate(
  signature: SignatureRow,
  events: AuditEventRow[],
  firstViewedAt: Date | null,
): SignatureCertificateView {
  const signedEvent = signedEventOf(signature.id, events);
  return {
    id: signature.id,
    method: signature.method,
    signerName: signature.signerName,
    signerEmail: signature.signerEmail,
    signerTitle: signature.signerTitle,
    signerCompany: signature.signerCompany,
    imageDataUri: signature.imagePng ? pngDataUri(signature.imagePng) : null,
    consentText: signature.consentText,
    consentVersion: signature.consentVersion,
    documentHash: signature.documentHash,
    hashVerified: snapshotMatches(signature.snapshot, signature.documentHash),
    signedAt: signature.signedAt.toISOString(),
    signerTimeZone: signedEvent ? metaString(metaOf(signedEvent.meta), "timeZone") : null,
    ipAddress: signature.ipAddress,
    browser: browserSummary(signature.userAgent),
    agencyName: AGENCY_NAME,
    // Only what happened up to the signature: nothing after it is evidence of it.
    timeline: timelineOf(
      signature,
      events.filter((e) => e.type !== "SIGNED" && e.createdAt <= signature.signedAt),
      firstViewedAt && firstViewedAt <= signature.signedAt ? firstViewedAt : null,
    ),
  };
}

/** A signed proposal as the page shows it: the document as signed, and its certificate. */
export type SignedProposalView = {
  document: ProposalDocumentView;
  certificate: SignatureCertificateView;
};

/**
 * The signed record, or null when there is no signature, or its snapshot is
 * not one this code can read (then the caller falls back to the live row).
 */
export function signedRecordOf(
  signature: SignatureRow | undefined | null,
  events: AuditEventRow[],
  firstViewedAt: Date | null,
): SignedProposalView | null {
  if (!signature) return null;
  const snapshot = parseSnapshot(signature.snapshot);
  if (!snapshot) return null;
  return {
    document: documentFromSnapshot(snapshot),
    certificate: toCertificate(signature, events, firstViewedAt),
  };
}
