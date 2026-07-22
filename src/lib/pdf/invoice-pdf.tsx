import "server-only";
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

/**
 * Generated invoice document, matching the agency's house style (logo + NO.
 * header, big headline, Billed-to/From columns, Item/Amount table, Tax/Price/
 * Total, bank details + signature footer).
 *
 * Everything arrives pre-serialized (no Decimals/Dates). Built-in Helvetica
 * only — font embedding is the classic breakage on restricted hosts. Logo and
 * signature images must be PNG/JPG (react-pdf can't rasterize SVG); logo falls
 * back to a text wordmark, signature simply omits.
 */

export type InvoicePdfData = {
  invoiceNumber: string;
  /** Big document headline; falls back to "Invoice {number}". */
  title: string | null;
  currency: "USD" | "EUR";
  status: string;
  issueDate: string;
  dueDate: string | null;
  notes: string | null;
  /** Line items; empty = legacy single-amount invoice (one fallback line). */
  items: { description: string; qty: number; rate: number }[];
  total: number;
  client: { name: string; company: string | null; email: string };
  branding: {
    color: string;
    logoDataUri: string | null;
    signatureDataUri: string | null;
  };
  bankAccounts: {
    title: string;
    holderName: string;
    bankName: string;
    fields: { label: string; value: string }[];
  }[];
};

/** The From block on every invoice. */
const AGENCY = {
  name: "Akib Zawayed",
  company: "Avixdigital",
  address: "187 G. RK Mission road -2200, Mymensigh",
  email: "avixdigitalagency@gmail.com",
  role: "Project manager",
  site: "avixdigital.com",
};

/**
 * A line item's description may be multi-line. First line = bold title; each
 * later line renders as a bullet, except lines ending in ":" which become
 * underlined group headings (matching the house invoice style).
 */
function describe(description: string) {
  const [title, ...rest] = description.split("\n").map((l) => l.trim());
  return {
    title: title || description,
    detail: rest.filter(Boolean).map((line) => ({
      text: line.replace(/^[-•*]\s*/, ""),
      isGroup: line.endsWith(":"),
    })),
  };
}

function money(n: number, currency: "USD" | "EUR"): string {
  const sym = currency === "EUR" ? "€" : "$";
  return `${sym}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildStyles(accent: string) {
  return StyleSheet.create({
    page: { padding: 44, fontSize: 10, fontFamily: "Helvetica", color: "#111827" },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 22 },
    logo: { height: 36, objectFit: "contain" },
    wordmark: { fontSize: 22, fontFamily: "Helvetica-Bold", color: accent },
    invoiceNo: { fontSize: 13, color: "#111827", letterSpacing: 0.5 },
    headline: {
      fontSize: 21, fontFamily: "Helvetica-Bold", textTransform: "uppercase",
      lineHeight: 1.2, marginBottom: 16,
    },
    issueRow: { flexDirection: "row", marginBottom: 14 },
    bold: { fontFamily: "Helvetica-Bold" },
    partiesRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
    partyCol: { width: "47%" },
    partyHeading: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 5 },
    partyLine: { marginBottom: 1, lineHeight: 1.3 },
    muted: { color: "#4b5563" },
    notesLine: { textDecoration: "underline", marginBottom: 10 },
    tableHeader: {
      flexDirection: "row", backgroundColor: "#e5e7eb",
      paddingVertical: 8, paddingHorizontal: 12,
    },
    thItem: { flex: 1, fontSize: 11, fontFamily: "Helvetica-Bold" },
    thAmount: { width: 120, fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "right" },
    // minHeight keeps the Tax/Price/Total block pinned to the bottom of the
    // box (via marginTop:"auto"). Sized so a typical invoice still leaves room
    // for the bank/signature footer on page 1 — larger values pushed the whole
    // footer onto page 2.
    tableBody: { flexDirection: "row", borderWidth: 0.75, borderColor: "#d1d5db", minHeight: 170 },
    itemCol: { flex: 1, padding: 12, borderRightWidth: 0.75, borderRightColor: "#d1d5db" },
    amountCol: { width: 120, padding: 12 },
    itemTitle: { fontFamily: "Helvetica-Bold", fontSize: 11, marginBottom: 4 },
    itemRow: { marginBottom: 10 },
    /** "Heading :" lines inside a description — underlined like the house style. */
    itemGroup: { textDecoration: "underline", fontSize: 8.5, marginTop: 4, marginBottom: 2 },
    bulletRow: { flexDirection: "row", marginBottom: 1.5, paddingLeft: 6 },
    bulletDot: { width: 8, fontSize: 8.5 },
    bulletText: { flex: 1, fontSize: 8.5, lineHeight: 1.35 },
    amountBlock: { marginBottom: 12, alignItems: "flex-end" },
    amountBig: { fontFamily: "Helvetica-Bold", fontSize: 13 },
    amountNote: { fontSize: 7.5, color: "#6b7280", marginTop: 2 },
    summary: { marginTop: "auto", alignItems: "flex-end" },
    summaryRow: { flexDirection: "row", marginBottom: 3 },
    summaryLabel: { fontFamily: "Helvetica-Bold", marginRight: 18 },
    summaryValue: { width: 70, textAlign: "right" },
    paidStamp: {
      alignSelf: "flex-start", borderWidth: 2, borderColor: "#059669", color: "#059669",
      paddingVertical: 3, paddingHorizontal: 10, fontSize: 12,
      fontFamily: "Helvetica-Bold", marginBottom: 14,
    },
    footerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 },
    bankCol: { width: "58%" },
    bankLine: { marginBottom: 1.5, lineHeight: 1.3, fontSize: 9 },
    bankLabel: { fontFamily: "Helvetica-Bold", textDecoration: "underline" },
    signCol: { width: "34%", alignItems: "flex-start" },
    signHeading: { fontSize: 13, fontFamily: "Helvetica-Bold", marginBottom: 8 },
    signImage: { height: 46, objectFit: "contain" },
  });
}

export function invoicePdfDocument(data: InvoicePdfData) {
  const s = buildStyles(data.branding.color);
  const rows =
    data.items.length > 0
      ? data.items
      : [{ description: data.notes || "Services rendered", qty: 1, rate: data.total }];
  const headline = data.title?.trim() || `Invoice ${data.invoiceNumber}`;
  const shortNo = data.invoiceNumber.replace(/^INV-/i, "");

  return (
    <Document title={`Invoice ${data.invoiceNumber}`} author={AGENCY.company}>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          {data.branding.logoDataUri ? (
            /* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */
            <Image src={data.branding.logoDataUri} style={s.logo} />
          ) : (
            <Text style={s.wordmark}>avixdigital</Text>
          )}
          <Text style={s.invoiceNo}>NO. {shortNo}</Text>
        </View>

        <Text style={s.headline}>{headline}</Text>

        <View style={s.issueRow}>
          <Text style={s.bold}>Issue Date: </Text>
          <Text>{data.issueDate}</Text>
          {data.dueDate ? (
            <>
              <Text style={{ ...s.bold, marginLeft: 18 }}>Due Date: </Text>
              <Text>{data.dueDate}</Text>
            </>
          ) : null}
        </View>

        {data.status === "PAID" && <Text style={s.paidStamp}>PAID</Text>}

        <View style={s.partiesRow}>
          <View style={s.partyCol}>
            <Text style={s.partyHeading}>Billed to:</Text>
            <Text style={s.partyLine}>{data.client.name}</Text>
            {data.client.company ? (
              <Text style={s.partyLine}>
                <Text style={s.bold}>Company: </Text>
                {data.client.company}
              </Text>
            ) : null}
            <Text style={{ ...s.partyLine, ...s.muted }}>{data.client.email}</Text>
          </View>
          <View style={s.partyCol}>
            <Text style={s.partyHeading}>From:</Text>
            <Text style={s.partyLine}>{AGENCY.name},</Text>
            <Text style={s.partyLine}>
              <Text style={s.bold}>Company </Text>: {AGENCY.company}
            </Text>
            <Text style={s.partyLine}>{AGENCY.address}</Text>
            <Text style={{ ...s.partyLine, ...s.muted }}>{AGENCY.email}</Text>
            <Text style={s.partyLine}>{AGENCY.role}</Text>
            <Text style={{ ...s.partyLine, ...s.muted }}>{AGENCY.site}</Text>
          </View>
        </View>

        {data.items.length > 0 && data.notes ? (
          <Text style={s.notesLine}>{data.notes}</Text>
        ) : null}

        <View style={s.tableHeader}>
          <Text style={s.thItem}>Item</Text>
          <Text style={s.thAmount}>Amount</Text>
        </View>
        <View style={s.tableBody}>
          <View style={s.itemCol}>
            {rows.map((item, i) => {
              const { title, detail } = describe(item.description);
              return (
                <View key={i} style={s.itemRow}>
                  <Text style={s.itemTitle}>{title}</Text>
                  {detail.map((line, j) =>
                    line.isGroup ? (
                      <Text key={j} style={s.itemGroup}>
                        {line.text}
                      </Text>
                    ) : (
                      <View key={j} style={s.bulletRow}>
                        <Text style={s.bulletDot}>•</Text>
                        <Text style={s.bulletText}>{line.text}</Text>
                      </View>
                    ),
                  )}
                </View>
              );
            })}
          </View>
          <View style={s.amountCol}>
            {rows.map((item, i) => (
              <View key={i} style={s.amountBlock} wrap={false}>
                <Text style={s.amountBig}>{money(item.qty * item.rate, data.currency)}</Text>
                {item.qty !== 1 ? (
                  <Text style={s.amountNote}>
                    {item.qty} × {money(item.rate, data.currency)}
                  </Text>
                ) : null}
              </View>
            ))}
            <View style={s.summary}>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Tax</Text>
                <Text style={s.summaryValue}>0</Text>
              </View>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Price</Text>
                <Text style={s.summaryValue}>{money(data.total, data.currency)}</Text>
              </View>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Total -</Text>
                <Text style={s.summaryValue}>{money(data.total, data.currency)}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={s.footerRow}>
          <View style={s.bankCol}>
            {data.bankAccounts.map((acct, i) => (
              <View key={i} style={{ marginBottom: 10 }}>
                <Text style={s.bankLine}>
                  <Text style={s.bankLabel}>Bank name</Text> : {acct.bankName},
                </Text>
                {acct.fields.map((f, j) => (
                  <Text key={j} style={s.bankLine}>
                    <Text style={s.bankLabel}>{f.label}</Text> : {f.value} ,
                  </Text>
                ))}
                <Text style={s.bankLine}>
                  <Text style={s.bankLabel}>Beneficiary name</Text> : {acct.holderName}
                </Text>
              </View>
            ))}
          </View>
          <View style={s.signCol}>
            <Text style={s.signHeading}>Billers Signature:</Text>
            {data.branding.signatureDataUri ? (
              /* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */
              <Image src={data.branding.signatureDataUri} style={s.signImage} />
            ) : null}
          </View>
        </View>
      </Page>
    </Document>
  );
}

export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(invoicePdfDocument(data));
}
