import "server-only";
import path from "path";
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

/**
 * Poppins, embedded from bundled TTFs in public/fonts (the proven-reliable
 * asset location — same as the logo). react-pdf can only parse TTF, so a
 * woff/woff2 package would not work. Registered once per server process.
 */
const FONT = "Poppins";
let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  Font.register({
    family: FONT,
    fonts: [
      { src: path.join(dir, "Poppins-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "Poppins-Medium.ttf"), fontWeight: 500 },
      { src: path.join(dir, "Poppins-SemiBold.ttf"), fontWeight: 600 },
      { src: path.join(dir, "Poppins-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // Poppins has no hyphenation data; keep long words intact rather than split.
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

/**
 * Generated invoice document, matching the agency's house style (logo + NO.
 * header, big headline, Billed-to/From columns, Item/Amount table, bank
 * details + signature footer).
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
  };
  /** The one bank account the admin chose to print; null = omit. */
  bankAccount: {
    holderName: string;
    bankName: string;
    fields: { label: string; value: string }[];
  } | null;
};

/** The From block on every invoice. */
const AGENCY = {
  name: "Akib Zawayed",
  company: "Avixdigital",
  address: "187 G. RK Mission road -2200, Mymensigh",
  email: "info@avixdigital.com",
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
    page: { padding: 44, fontSize: 10, fontFamily: FONT, color: "#1f2937", lineHeight: 1.4 },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 26 },
    logo: { height: 34, objectFit: "contain" },
    wordmark: { fontSize: 20, fontWeight: 700, color: accent },
    invoiceNo: { fontSize: 12, fontWeight: 500, color: "#6b7280", letterSpacing: 0.5 },
    headline: {
      fontSize: 19, fontWeight: 700, color: "#111827",
      lineHeight: 1.25, marginBottom: 16, maxWidth: "88%",
    },
    issueRow: { flexDirection: "row", marginBottom: 16 },
    bold: { fontWeight: 700 },
    semi: { fontWeight: 600 },
    partiesRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
    partyCol: { width: "47%" },
    partyHeading: { fontSize: 11, fontWeight: 600, marginBottom: 4, color: accent, textTransform: "uppercase", letterSpacing: 0.5 },
    partyName: { fontSize: 11.5, fontWeight: 600, marginBottom: 1 },
    partyLine: { marginBottom: 0.5, fontSize: 9.5 },
    muted: { color: "#6b7280" },
    notesLine: { fontSize: 9.5, color: "#374151", marginBottom: 10 },
    // Table
    tableHeader: {
      flexDirection: "row", backgroundColor: accent,
      paddingVertical: 7, paddingHorizontal: 12,
    },
    thItem: { flex: 1, fontSize: 10, fontWeight: 600, color: "#ffffff", letterSpacing: 0.3 },
    thAmount: { width: 110, fontSize: 10, fontWeight: 600, color: "#ffffff", textAlign: "right", letterSpacing: 0.3 },
    tableBody: {
      flexDirection: "row",
      borderLeftWidth: 0.75, borderRightWidth: 0.75, borderBottomWidth: 0.75, borderColor: "#e5e7eb",
      minHeight: 130,
    },
    itemCol: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRightWidth: 0.75, borderRightColor: "#e5e7eb" },
    amountCol: { width: 110, paddingVertical: 10, paddingHorizontal: 12 },
    itemTitle: { fontWeight: 600, fontSize: 10.5, marginBottom: 2 },
    itemRow: { marginBottom: 5 },
    /** "Heading :" lines inside a description. */
    itemGroup: { fontWeight: 600, fontSize: 8.5, marginTop: 3, marginBottom: 1, color: "#4b5563" },
    bulletRow: { flexDirection: "row", marginBottom: 0.5, paddingLeft: 4 },
    bulletDot: { width: 8, fontSize: 8, color: accent },
    bulletText: { flex: 1, fontSize: 8.5, lineHeight: 1.3, color: "#4b5563" },
    amountBlock: { marginBottom: 5, alignItems: "flex-end" },
    amountBig: { fontWeight: 600, fontSize: 11 },
    amountNote: { fontSize: 7.5, color: "#9ca3af", marginTop: 1 },
    // Total row (spans full width under the table)
    totalRow: {
      flexDirection: "row", alignItems: "center",
      borderLeftWidth: 0.75, borderRightWidth: 0.75, borderBottomWidth: 0.75, borderColor: "#e5e7eb",
      backgroundColor: "#f9fafb",
    },
    totalLabelCell: {
      flex: 1, paddingVertical: 9, paddingHorizontal: 12,
      borderRightWidth: 0.75, borderRightColor: "#e5e7eb",
    },
    totalLabel: { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 },
    totalAmountCell: { width: 110, paddingVertical: 9, paddingHorizontal: 12, alignItems: "flex-end" },
    totalAmount: { fontSize: 13, fontWeight: 700, color: accent },
    paidStamp: {
      alignSelf: "flex-start", borderWidth: 1.5, borderColor: "#059669", color: "#059669",
      paddingVertical: 2, paddingHorizontal: 9, fontSize: 11,
      fontWeight: 700, marginBottom: 12, borderRadius: 3,
    },
    bankBlock: { marginTop: 18 },
    bankHeading: {
      fontSize: 9, fontWeight: 700, marginBottom: 5,
      textTransform: "uppercase", letterSpacing: 0.5, color: accent,
    },
    bankLine: { marginBottom: 1, lineHeight: 1.35, fontSize: 9 },
    bankLabel: { fontWeight: 600 },
  });
}

export function invoicePdfDocument(data: InvoicePdfData) {
  ensureFonts();
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
            <Text style={s.partyHeading}>Billed to</Text>
            <Text style={s.partyName}>{data.client.name}</Text>
            {data.client.company ? (
              <Text style={s.partyLine}>{data.client.company}</Text>
            ) : null}
            <Text style={{ ...s.partyLine, ...s.muted }}>{data.client.email}</Text>
          </View>
          <View style={s.partyCol}>
            <Text style={s.partyHeading}>From</Text>
            <Text style={s.partyName}>{AGENCY.name}</Text>
            <Text style={s.partyLine}>{AGENCY.company}</Text>
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
          </View>
        </View>

        <View style={s.totalRow} wrap={false}>
          <View style={s.totalLabelCell}>
            <Text style={s.totalLabel}>Total</Text>
          </View>
          <View style={s.totalAmountCell}>
            <Text style={s.totalAmount}>{money(data.total, data.currency)}</Text>
          </View>
        </View>

        {data.bankAccount ? (
          <View style={s.bankBlock}>
            <Text style={s.bankHeading}>Payment details</Text>
            <Text style={s.bankLine}>
              <Text style={s.bankLabel}>Bank name</Text> : {data.bankAccount.bankName},
            </Text>
            {data.bankAccount.fields.map((f, j) => (
              <Text key={j} style={s.bankLine}>
                <Text style={s.bankLabel}>{f.label}</Text> : {f.value} ,
              </Text>
            ))}
            <Text style={s.bankLine}>
              <Text style={s.bankLabel}>Beneficiary name</Text> : {data.bankAccount.holderName}
            </Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}

export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(invoicePdfDocument(data));
}
