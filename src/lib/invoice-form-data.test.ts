import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceSchema, type InvoiceInput } from "./validation/invoice";
import { INVOICE_FORM_KEYS, parseInvoiceForm, serializeInvoiceForm } from "./invoice-form-data";

/** Every field set to something other than its default, so a dropped one shows. */
const everyField: Required<InvoiceInput> = {
  items: [
    {
      id: "item_1",
      description: "Website redesign\n• New home page",
      descriptionRich: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Website redesign" }] }],
      },
      qty: 2,
      rate: 150,
    },
  ],
  invoiceNumber: "INV-900",
  title: "Website — June",
  currency: "EUR",
  billToCompany: "Acme GmbH",
  billToAddress: "1 Main St, Berlin",
  billToEmail: "ap@acme.test",
  paymentAccountId: "acct_1",
  clientId: "client_1",
  projectId: "project_1",
  amount: 300,
  status: "DRAFT",
  amountUsd: 325.5,
  discount: 20,
  taxRate: 15,
  taxLabel: "VAT",
  paymentTermsDays: 14,
  issueDate: "2026-11-02",
  dueDate: "2026-11-16",
  notes: "Thank you",
  payLinkUrl: "https://pay.example.com/inv-900",
  duplicatedFromId: "inv_source",
  pdfExternalUrl: "https://drive.example.com/file",
};

test("the parser has a reader for every schema field", () => {
  assert.deepEqual([...INVOICE_FORM_KEYS].sort(), Object.keys(invoiceSchema.shape).sort());
  assert.deepEqual(Object.keys(everyField).sort(), Object.keys(invoiceSchema.shape).sort());
});

test("every field survives the trip through FormData", () => {
  const parsed = parseInvoiceForm(serializeInvoiceForm(everyField));
  assert.ok(parsed.success, parsed.success ? "" : parsed.error.issues[0]?.message);
  assert.deepEqual(parsed.data, everyField);
});

test("blank optional numbers come back as not set, never as zero or NaN", () => {
  const formData = serializeInvoiceForm({
    ...everyField,
    amountUsd: null,
    taxRate: null,
    paymentTermsDays: null,
    discount: undefined,
  });
  const parsed = parseInvoiceForm(formData);
  assert.ok(parsed.success);
  assert.equal(parsed.data.amountUsd, null);
  assert.equal(parsed.data.taxRate, null);
  assert.equal(parsed.data.paymentTermsDays, null);
  assert.equal(parsed.data.discount, 0);
});

test('the word "null" from older form posts reads as not set', () => {
  const formData = serializeInvoiceForm(everyField);
  for (const key of ["amountUsd", "taxRate", "paymentTermsDays", "discount"]) {
    formData.set(key, "null");
  }
  const parsed = parseInvoiceForm(formData);
  assert.ok(parsed.success);
  assert.equal(parsed.data.amountUsd, null);
  assert.equal(parsed.data.taxRate, null);
  assert.equal(parsed.data.paymentTermsDays, null);
  assert.equal(parsed.data.discount, 0);
});

test("a mistyped number is rejected rather than cleared", () => {
  const formData = serializeInvoiceForm(everyField);
  formData.set("taxRate", "fifteen");
  assert.equal(parseInvoiceForm(formData).success, false);
});

test("without line items the amount governs, and must be above zero", () => {
  const noItems = serializeInvoiceForm({ ...everyField, items: [], amount: 0 });
  assert.equal(noItems.get("items"), null);
  assert.equal(parseInvoiceForm(noItems).success, false);
  noItems.set("amount", "450");
  const parsed = parseInvoiceForm(noItems);
  assert.ok(parsed.success);
  assert.equal(parsed.data.items, undefined);
  assert.equal(parsed.data.amount, 450);
});

test("a pay link must be a secure https:// address", () => {
  for (const bad of ["http://pay.example.com", "javascript:alert(1)", "pay.example.com", "https://"]) {
    const formData = serializeInvoiceForm({ ...everyField, payLinkUrl: bad });
    assert.equal(parseInvoiceForm(formData).success, false, bad);
  }
  const blank = parseInvoiceForm(serializeInvoiceForm({ ...everyField, payLinkUrl: "" }));
  assert.ok(blank.success);
  assert.equal(blank.data.payLinkUrl, "");
});
