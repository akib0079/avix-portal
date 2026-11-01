/**
 * Both ends of the invoice form's trip to the server.
 *
 * The form posts FormData (it can carry a PDF upload), and FormData is flat
 * strings, so every field is written as text by the form and read back into
 * the shape invoiceSchema expects by the server action. Those two halves used
 * to be written separately, and they drifted: the old reader listed its fields
 * by hand and never read amountUsd, discount, taxRate, taxLabel or
 * paymentTermsDays. All of them are optional in the schema, so parsing still
 * succeeded and every discount, tax line, payment term and USD value typed
 * into the form was thrown away on save.
 *
 * READERS is keyed by the schema's own keys: a field added to invoiceSchema
 * without a reader here is a type error, and invoice-form-data.test.ts
 * round-trips every key so it is a failing test as well.
 *
 * No server imports, so the client form and the tests can share it.
 */
import { invoiceSchema, type InvoiceInput } from "@/lib/validation/invoice";

type Entry = FormDataEntryValue | null;
type Reader = (value: Entry) => unknown;

/** A text field; a missing one reads as `fallback`. */
function text(fallback = ""): Reader {
  return (value) => (typeof value === "string" ? value : fallback);
}

/**
 * Blank means "not set", and so does "null": the form used to post optional
 * numbers with String(value), and String(null) is the word "null". Anything
 * else goes to the schema as a number, NaN included, so a mistyped value is
 * rejected instead of being quietly cleared.
 */
function optionalNumber(value: Entry): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "undefined") return null;
  return Number(trimmed);
}

const READERS: Record<keyof InvoiceInput, Reader> = {
  // Line items travel as one JSON field. Invalid JSON reads as "no items" and
  // the amount field governs, as it always has.
  items: (value) => {
    if (typeof value !== "string" || !value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  },
  invoiceNumber: text(),
  title: text(),
  currency: text("USD"),
  billToCompany: text(),
  billToAddress: text(),
  billToEmail: text(),
  paymentAccountId: text(),
  clientId: text(),
  projectId: text("none"),
  // Empty while line items drive the total, so blank is 0 here; the schema
  // rejects 0 only when there are no items.
  amount: (value) => optionalNumber(value) ?? 0,
  status: text("ASSIGNED"),
  amountUsd: optionalNumber,
  // The schema wants a number, never null: no discount is a discount of 0.
  discount: (value) => optionalNumber(value) ?? 0,
  taxRate: optionalNumber,
  taxLabel: text(),
  paymentTermsDays: optionalNumber,
  issueDate: text(),
  dueDate: text(),
  notes: text(),
  pdfExternalUrl: text(),
};

/** The schema's field names, in one place for the form, the parser and the tests. */
export const INVOICE_FORM_KEYS = Object.keys(READERS) as (keyof InvoiceInput)[];

/**
 * What the form posts. null and undefined travel as "" (never as "null"), and
 * an empty line-item list is left out: no items means the amount governs.
 */
export function serializeInvoiceForm(values: InvoiceInput): FormData {
  const formData = new FormData();
  for (const key of INVOICE_FORM_KEYS) {
    const value = values[key];
    if (key === "items") {
      if (Array.isArray(value) && value.length > 0) formData.append(key, JSON.stringify(value));
      continue;
    }
    formData.append(key, value == null ? "" : String(value));
  }
  return formData;
}

/** What the server reads: every schema field, coerced back from text, validated. */
export function parseInvoiceForm(formData: FormData) {
  const raw = Object.fromEntries(
    INVOICE_FORM_KEYS.map((key) => [key, READERS[key](formData.get(key))]),
  );
  return invoiceSchema.safeParse(raw);
}
