import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceCopyDefaults, todayIn, type InvoiceCopySource } from "./invoice-copy";
import { invoiceSchema } from "./validation/invoice";

const rich = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Monthly care", marks: [{ type: "bold" }] }] },
    { type: "bulletList", content: [] },
  ],
};

function source(overrides: Partial<InvoiceCopySource> = {}): InvoiceCopySource {
  return {
    id: "inv_14",
    invoiceNumber: "INV-014",
    clientId: "client_1",
    project: { id: "project_1", clientId: "client_1" },
    title: "Website care — October",
    currency: "EUR",
    amount: 322,
    subtotal: 300,
    amountUsd: 351.2,
    discount: 20,
    taxRate: 15,
    taxLabel: "VAT",
    paymentTermsDays: 14,
    issueDate: new Date("2026-10-01T00:00:00Z"),
    dueDate: new Date("2026-10-15T00:00:00Z"),
    notes: "Thank you",
    billToCompany: "Acme GmbH",
    billToAddress: "1 Main St, Berlin",
    billToEmail: "ap@acme.test",
    paymentAccount: { id: "acct_sepa", isActive: true },
    creditNoteForId: null,
    items: [{ description: "Monthly care", descriptionRich: rich, qty: 2, rate: 150 }],
    ...overrides,
  };
}

function copyOf(overrides: Partial<InvoiceCopySource> = {}, today = "2026-11-02") {
  const copy = invoiceCopyDefaults(source(overrides), { today });
  assert.ok(copy.ok);
  return copy;
}

test("copies the work and the terms, resets what belongs to one invoice", () => {
  const { input } = copyOf();
  assert.equal(input.clientId, "client_1");
  assert.equal(input.projectId, "project_1");
  assert.equal(input.title, "Website care — October");
  assert.equal(input.currency, "EUR");
  assert.equal(input.discount, 20);
  assert.equal(input.taxRate, 15);
  assert.equal(input.taxLabel, "VAT");
  assert.equal(input.paymentTermsDays, 14);
  assert.equal(input.notes, "Thank you");
  assert.equal(input.billToCompany, "Acme GmbH");
  assert.equal(input.billToAddress, "1 Main St, Berlin");
  assert.equal(input.billToEmail, "ap@acme.test");
  assert.equal(input.paymentAccountId, "acct_sepa");
  assert.equal(input.duplicatedFromId, "inv_14");

  assert.equal(input.invoiceNumber, "");
  assert.equal(input.status, "DRAFT");
  assert.equal(input.issueDate, "2026-11-02");
  assert.equal(input.pdfExternalUrl, "");
  assert.equal(input.payLinkUrl, "");
});

test("the copy passes the form's own validation as it stands", () => {
  const { input } = copyOf();
  assert.ok(invoiceSchema.safeParse(input).success);
});

test("lines are copied with their formatting, as an independent copy", () => {
  const original = source();
  const copy = invoiceCopyDefaults(original, { today: "2026-11-02" });
  assert.ok(copy.ok);
  const line = copy.input.items![0]!;
  assert.deepEqual(line.descriptionRich, rich);
  (line.descriptionRich as typeof rich).content.pop();
  assert.equal(rich.content.length, 2, "editing the copy must not change the source");
  assert.deepEqual(
    { description: line.description, qty: line.qty, rate: line.rate },
    { description: "Monthly care", qty: 2, rate: 150 },
  );
});

test("the due date comes from the terms, else last time's gap, else none", () => {
  assert.equal(copyOf().input.dueDate, "2026-11-16");
  assert.equal(copyOf({ paymentTermsDays: 0 }).input.dueDate, "2026-11-02");
  // No terms: the source was due 14 days after issue, so is the copy.
  assert.equal(copyOf({ paymentTermsDays: null }).input.dueDate, "2026-11-16");
  assert.equal(copyOf({ paymentTermsDays: null, dueDate: null }).input.dueDate, "");
  // Across a month end, in UTC whatever the server's zone.
  assert.equal(copyOf({ paymentTermsDays: 30 }, "2027-01-31").input.dueDate, "2027-03-02");
});

test("a project now belonging to someone else is not carried over", () => {
  assert.equal(copyOf({ project: { id: "project_1", clientId: "client_2" } }).input.projectId, "none");
  assert.equal(copyOf({ project: { id: "project_1", clientId: null } }).input.projectId, "none");
  assert.equal(copyOf({ project: null }).input.projectId, "none");
});

test("a retired payment account is not carried over", () => {
  assert.equal(
    copyOf({ paymentAccount: { id: "acct_old", isActive: false } }).input.paymentAccountId,
    "none",
  );
  assert.equal(copyOf({ paymentAccount: null }).input.paymentAccountId, "none");
});

test("USD mirrors the total; other currencies wait, with last time's value as a hint", () => {
  const eur = copyOf();
  assert.equal(eur.input.amountUsd, null);
  assert.equal(eur.lastAmountUsd, 351.2);
  const usd = copyOf({ currency: "USD", amountUsd: 322 });
  assert.equal(usd.input.amountUsd, 322);
  assert.equal(usd.input.amount, 322);
  assert.equal(usd.lastAmountUsd, null);
});

test("an invoice from before line items becomes one real line", () => {
  const { input } = copyOf({ items: [], notes: "Logo design", subtotal: 300 });
  assert.deepEqual(input.items, [
    { description: "Logo design", descriptionRich: null, qty: 1, rate: 300 },
  ]);
  assert.equal(input.notes, "", "the notes moved into the line, as the PDF printed them");
  assert.equal(input.amount, 322);
  const bare = copyOf({ items: [], notes: null, subtotal: null, amount: 450, discount: 0, taxRate: null });
  assert.deepEqual(bare.input.items, [
    { description: "Services rendered", descriptionRich: null, qty: 1, rate: 450 },
  ]);
});

test("credit notes are refused", () => {
  const copy = invoiceCopyDefaults(source({ creditNoteForId: "inv_9" }), { today: "2026-11-02" });
  assert.equal(copy.ok, false);
});

test("today is the date in the agency's zone, not the server's", () => {
  const lateEvening = new Date("2026-11-01T20:00:00Z");
  assert.equal(todayIn("Asia/Dhaka", lateEvening), "2026-11-02");
  assert.equal(todayIn("America/New_York", lateEvening), "2026-11-01");
  assert.equal(todayIn("Not/AZone", lateEvening), "2026-11-01");
});
