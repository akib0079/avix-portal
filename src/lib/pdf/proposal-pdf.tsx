import "server-only";
import path from "path";
import { existsSync } from "fs";
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
  renderToBuffer,
} from "@react-pdf/renderer";
import { FONT, ensureFonts } from "@/lib/pdf/invoice-pdf";
import { formatCurrency } from "@/lib/currency";
import { AGENCY_NAME, shortHash } from "@/lib/signature-rules";
import type { ProposalDocumentView } from "@/lib/proposal-snapshot";
import type { SignatureCertificateView } from "@/lib/dal/proposal-signatures";

/**
 * The signed proposal as a PDF: cover and scope, terms, and a certificate
 * page. Built like the invoice (same Poppins faces, logo and accent colour)
 * and rendered from the signature's SNAPSHOT, never the live proposal, so a
 * copy made years later still shows what was signed.
 *
 * PDF bytes are not stable across renders (timestamps, library versions), so
 * the document hash printed here, not the PDF's own checksum, is the evidence.
 */

export type ProposalPdfData = {
  document: ProposalDocumentView;
  certificate: SignatureCertificateView;
  branding: { color: string; logoDataUri: string | null };
};

const SCRIPT = "DancingScript";
let scriptAvailable: boolean | null = null;

/**
 * The typed signature's script face. The page uses Dancing Script through
 * next/font; drop DancingScript-Regular.ttf (SIL Open Font License) into
 * public/fonts and the PDF uses the same face with no code change. Until then
 * the typed name is set in Times Italic, a built-in PDF face, or in Poppins
 * for names Times can't spell (it only covers Western European letters).
 */
function ensureScriptFont(): boolean {
  if (scriptAvailable !== null) return scriptAvailable;
  const file = path.join(process.cwd(), "public", "fonts", "DancingScript-Regular.ttf");
  scriptAvailable = existsSync(file);
  if (scriptAvailable) Font.register({ family: SCRIPT, src: file });
  return scriptAvailable;
}

/** What the built-in PDF faces can print (Windows-1252). */
const WIN_ANSI =
  /^[ -~ -ÿŒœŠšŸŽžƒˆ˜–—‘-‚“-„†-•…‰‹›€™]*$/;

function typedSignatureFont(name: string) {
  if (ensureScriptFont()) return { fontFamily: SCRIPT };
  if (WIN_ANSI.test(name)) return { fontFamily: "Times-Roman", fontStyle: "italic" as const };
  return { fontFamily: FONT, fontWeight: 500 };
}

function utc(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(iso));
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The signer's own wall clock, when their browser told us their zone. */
function inZone(iso: string, timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

function buildStyles(accent: string) {
  return StyleSheet.create({
    page: { paddingTop: 44, paddingHorizontal: 44, paddingBottom: 64, fontSize: 10, fontFamily: FONT, color: "#1f2937", lineHeight: 1.45 },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 26 },
    logo: { height: 34, objectFit: "contain" },
    wordmark: { fontSize: 20, fontWeight: 700, color: accent },
    kicker: { fontSize: 11, fontWeight: 600, color: "#6b7280", letterSpacing: 1.2, textTransform: "uppercase" },
    headline: { fontSize: 22, fontWeight: 700, color: "#111827", lineHeight: 1.25, marginBottom: 8 },
    preparedFor: { fontSize: 11, color: "#374151", marginBottom: 14 },
    factsRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 18 },
    fact: { marginRight: 22, marginBottom: 4 },
    factLabel: { fontSize: 8, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 },
    factValue: { fontSize: 10, fontWeight: 500 },
    sectionHeading: { fontSize: 11, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6, marginTop: 6 },
    body: { fontSize: 10, color: "#374151", lineHeight: 1.55 },
    introBox: { borderLeftWidth: 2, borderLeftColor: accent, paddingLeft: 10, marginBottom: 18 },
    tableHeader: { flexDirection: "row", backgroundColor: accent, paddingVertical: 7, paddingHorizontal: 12 },
    th: { flex: 1, fontSize: 10, fontWeight: 600, color: "#ffffff" },
    thAmount: { width: 120, fontSize: 10, fontWeight: 600, color: "#ffffff", textAlign: "right" },
    row: {
      flexDirection: "row", paddingVertical: 8, paddingHorizontal: 12,
      borderLeftWidth: 0.75, borderRightWidth: 0.75, borderBottomWidth: 0.75, borderColor: "#e5e7eb",
    },
    cell: { flex: 1, paddingRight: 10 },
    cellAmount: { width: 120, textAlign: "right", fontWeight: 500 },
    totalRow: {
      flexDirection: "row", paddingVertical: 9, paddingHorizontal: 12, backgroundColor: "#f9fafb",
      borderLeftWidth: 0.75, borderRightWidth: 0.75, borderBottomWidth: 0.75, borderColor: "#e5e7eb",
    },
    totalLabel: { flex: 1, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 },
    totalAmount: { width: 120, textAlign: "right", fontSize: 13, fontWeight: 700, color: accent },
    note: { fontSize: 9, color: "#4b5563", marginTop: 6 },
    // Certificate
    statement: { fontSize: 11, color: "#374151", marginBottom: 12 },
    signatureBox: {
      borderWidth: 0.75, borderColor: "#d1d5db", borderRadius: 6, height: 110,
      alignItems: "center", justifyContent: "center", paddingHorizontal: 16, marginBottom: 16,
    },
    signatureImage: { maxHeight: 90, maxWidth: 420, objectFit: "contain" },
    typedSignature: { fontSize: 32, color: "#0f172a", textAlign: "center" },
    recordedNote: { fontSize: 10, color: "#4b5563", textAlign: "center" },
    detailGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
    detail: { width: "50%", paddingRight: 12, marginBottom: 9 },
    detailLabel: { fontSize: 8, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 },
    detailValue: { fontSize: 9.5 },
    mono: { fontFamily: "Courier", fontSize: 8.5 },
    consentBox: { backgroundColor: "#f9fafb", borderWidth: 0.75, borderColor: "#e5e7eb", borderRadius: 6, padding: 10, marginBottom: 14 },
    trailRow: { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
    trailWhen: { width: 190, fontSize: 9, color: "#4b5563" },
    trailWhat: { flex: 1, fontSize: 9 },
    footnote: { fontSize: 8, color: "#6b7280", marginTop: 14, lineHeight: 1.45 },
    // Two separately placed pieces, each with its own lineHeight: in a row
    // container, or inheriting the page's unitless lineHeight, react-pdf
    // drops a fixed footer from every page. (A render-prop page number is
    // dropped the same way, hence none.)
    footerRule: { position: "absolute", left: 44, right: 44, bottom: 40, borderTopWidth: 0.5, borderTopColor: "#e5e7eb" },
    footerText: { position: "absolute", left: 44, right: 44, bottom: 26, fontSize: 7.5, lineHeight: 1, color: "#9ca3af" },
  });
}

type Styles = ReturnType<typeof buildStyles>;

function Header({ s, logo, kicker }: { s: Styles; logo: string | null; kicker: string }) {
  return (
    <View style={s.headerRow}>
      {logo ? (
        /* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */
        <Image src={logo} style={s.logo} />
      ) : (
        <Text style={s.wordmark}>avixdigital</Text>
      )}
      <Text style={s.kicker}>{kicker}</Text>
    </View>
  );
}

/** On every page: which document this is, by its fingerprint. */
function Footer({ s, title, hash }: { s: Styles; title: string; hash: string }) {
  return (
    <>
      <View style={s.footerRule} fixed />
      <Text style={s.footerText} fixed>{`${AGENCY_NAME} · ${title} · SHA-256 ${shortHash(hash)}`}</Text>
    </>
  );
}

function Detail({ s, label, value, mono }: { s: Styles; label: string; value: string; mono?: boolean }) {
  return (
    <View style={s.detail}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={mono ? s.mono : s.detailValue}>{value}</Text>
    </View>
  );
}

export function proposalPdfDocument(data: ProposalPdfData) {
  ensureFonts();
  const s = buildStyles(data.branding.color);
  const doc = data.document;
  const c = data.certificate;
  const recorded = c.method === "ADMIN_RECORDED";
  const first = doc.firstInvoice;
  const signerLocal = c.signerTimeZone ? inZone(c.signedAt, c.signerTimeZone) : null;

  return (
    <Document title={`Signed proposal: ${doc.title}`} author={c.agencyName} subject={`SHA-256 ${c.documentHash}`}>
      <Page size="A4" style={s.page}>
        <Header s={s} logo={data.branding.logoDataUri} kicker="Proposal" />
        <Text style={s.headline}>{doc.title}</Text>
        <Text style={s.preparedFor}>
          Prepared for {doc.preparedFor}
          {doc.preparedFor !== doc.recipientName ? ` (${doc.recipientName})` : ""} by {c.agencyName}
        </Text>

        <View style={s.factsRow}>
          {doc.sentAt ? (
            <View style={s.fact}>
              <Text style={s.factLabel}>Sent</Text>
              <Text style={s.factValue}>{day(doc.sentAt)}</Text>
            </View>
          ) : null}
          {doc.expiresAt ? (
            <View style={s.fact}>
              <Text style={s.factLabel}>Valid until</Text>
              <Text style={s.factValue}>{day(doc.expiresAt)}</Text>
            </View>
          ) : null}
          <View style={s.fact}>
            <Text style={s.factLabel}>{recorded ? "Accepted" : "Signed"}</Text>
            <Text style={s.factValue}>
              {day(c.signedAt)} by {c.signerName}
            </Text>
          </View>
        </View>

        {doc.intro ? (
          <View style={s.introBox}>
            <Text style={s.body}>{doc.intro}</Text>
          </View>
        ) : null}

        <Text style={s.sectionHeading}>Scope</Text>
        <View style={s.tableHeader}>
          <Text style={s.th}>Item</Text>
          <Text style={s.thAmount}>Amount</Text>
        </View>
        {doc.items.map((item) => (
          <View key={item.key} style={s.row} wrap={false}>
            <Text style={s.cell}>{item.description}</Text>
            <Text style={s.cellAmount}>{formatCurrency(item.amount, doc.currency)}</Text>
          </View>
        ))}
        <View style={s.totalRow} wrap={false}>
          <Text style={s.totalLabel}>Total</Text>
          <Text style={s.totalAmount}>{formatCurrency(doc.total, doc.currency)}</Text>
        </View>
        {first ? (
          <Text style={s.note}>
            {first.kind === "invoice" ? "First invoice to get started" : `${first.percent}% deposit to start`}:{" "}
            {formatCurrency(first.amount, first.currency)}
          </Text>
        ) : null}
        {doc.timelineWeeks ? (
          <Text style={s.note}>
            Estimated timeline: {doc.timelineWeeks} week{doc.timelineWeeks === 1 ? "" : "s"}
          </Text>
        ) : null}

        {doc.terms ? (
          <View style={{ marginTop: 18 }}>
            <Text style={s.sectionHeading}>Terms</Text>
            <Text style={s.body}>{doc.terms}</Text>
          </View>
        ) : null}

        <Footer s={s} title={doc.title} hash={c.documentHash} />
      </Page>

      <Page size="A4" style={s.page}>
        <Header s={s} logo={data.branding.logoDataUri} kicker="Signature certificate" />
        <Text style={s.statement}>
          {recorded
            ? `Recorded by ${c.agencyName} on behalf of ${c.signerName}.`
            : `Signed electronically by ${c.signerName}.`}
        </Text>

        <View style={s.signatureBox}>
          {c.imageDataUri ? (
            /* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */
            <Image src={c.imageDataUri} style={s.signatureImage} />
          ) : recorded ? (
            <Text style={s.recordedNote}>
              No signature was drawn: {c.agencyName} recorded this acceptance on {c.signerName}&apos;s behalf.
            </Text>
          ) : (
            <Text style={{ ...s.typedSignature, ...typedSignatureFont(c.signerName) }}>{c.signerName}</Text>
          )}
        </View>

        <View style={s.detailGrid}>
          <Detail s={s} label={recorded ? "Agreed by" : "Signed by"} value={c.signerName} />
          <Detail s={s} label="Email" value={c.signerEmail || "—"} />
          {c.signerTitle ? <Detail s={s} label="Job title" value={c.signerTitle} /> : null}
          {c.signerCompany ? <Detail s={s} label="Company" value={c.signerCompany} /> : null}
          <Detail s={s} label={recorded ? "Recorded (UTC)" : "Signed (UTC)"} value={utc(c.signedAt)} />
          {signerLocal ? <Detail s={s} label={`Signer's time (${c.signerTimeZone})`} value={signerLocal} /> : null}
          <Detail
            s={s}
            label="Method"
            value={
              c.method === "DRAWN"
                ? "Drawn on screen"
                : c.method === "TYPED"
                  ? "Typed name, in a signature style"
                  : `Recorded by ${c.agencyName}`
            }
          />
          <Detail s={s} label={recorded ? "Recorded from IP" : "IP address"} value={c.ipAddress ?? "Not available"} />
          <Detail s={s} label="Browser" value={c.browser ?? "Not available"} />
          <Detail s={s} label="Signature ID" value={c.id} mono />
        </View>

        <View style={s.consentBox} wrap={false}>
          <Text style={s.detailLabel}>{recorded ? "Statement" : "Consent given"}</Text>
          <Text style={{ ...s.body, marginTop: 2 }}>{c.consentText}</Text>
          <Text style={{ ...s.mono, color: "#6b7280", marginTop: 3 }}>{c.consentVersion}</Text>
        </View>

        <View style={{ marginBottom: 14 }} wrap={false}>
          <Text style={s.detailLabel}>Document fingerprint (SHA-256)</Text>
          <Text style={{ ...s.mono, marginTop: 2 }}>{c.documentHash}</Text>
        </View>

        <Text style={s.sectionHeading}>Audit trail</Text>
        {c.timeline.map((event) => (
          <View key={event.key} style={s.trailRow} wrap={false}>
            <Text style={s.trailWhen}>{utc(event.at)}</Text>
            <Text style={s.trailWhat}>
              {event.label}
              {event.detail ? ` · ${event.detail}` : ""}
            </Text>
          </View>
        ))}

        <Text style={s.footnote}>
          The fingerprint is the SHA-256 of the proposal exactly as it stood when{" "}
          {recorded ? "the acceptance was recorded" : "it was signed"}: its scope, prices, terms,
          recipient and dates, in a fixed canonical form. Any change to that content gives a different
          fingerprint. The IP address is as reported by the network and is supporting evidence, not
          proof of identity.
        </Text>

        <Footer s={s} title={doc.title} hash={c.documentHash} />
      </Page>
    </Document>
  );
}

export function renderProposalPdf(data: ProposalPdfData): Promise<Buffer> {
  return renderToBuffer(proposalPdfDocument(data));
}
