import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SNAPSHOT_VERSION,
  buildProposalSnapshot,
  canonicalJson,
  documentFromSnapshot,
  moneyString,
  parseSnapshot,
  snapshotHash,
  snapshotMatches,
  toCents,
  type SnapshotInput,
} from "./proposal-snapshot";

function input(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    proposalId: "cmproposal123",
    linkVersion: 2,
    title: "Shopify store build",
    intro: "Thanks for the call.\nHere's the plan.",
    terms: "Payment\n- 50% up front.",
    currency: "GBP",
    items: [
      { id: "b", description: "Theme build", amount: "1500.00", sortOrder: 1 },
      { id: "a", description: "Discovery", amount: 500, sortOrder: 0 },
    ],
    depositPercent: 50,
    firstInvoice: { kind: "deposit", percent: 50, amount: 1000, currency: "GBP" },
    timelineWeeks: 6,
    recipient: { name: "Jane Cooper", email: "Jane@Verdant.co", company: "Verdant" },
    agencyName: "Avix Digital",
    sentAt: new Date("2026-11-01T09:30:00.000Z"),
    expiresAt: "2026-12-01T09:30:00.000Z",
    ...overrides,
  };
}

/** Rebuilds an object with its keys in reverse order, as jsonb might hand it back. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .reverse()
        .map((key) => [key, reverseKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

test("canonical JSON sorts keys at every level and keeps array order", () => {
  const a = { b: 1, a: { d: "x", c: [3, { f: true, e: null }] } };
  const b = { a: { c: [3, { e: null, f: true }], d: "x" }, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalJson(a), '{"a":{"c":[3,{"e":null,"f":true}],"d":"x"},"b":1}');
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  // Undefined properties are left out, like JSON.stringify.
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
});

test("canonical JSON refuses what could hash two ways", () => {
  assert.throws(() => canonicalJson({ amount: 1500.5 }));
  assert.throws(() => canonicalJson({ n: Number.NaN }));
  assert.throws(() => canonicalJson({ at: new Date() }));
  assert.throws(() => canonicalJson({ big: 2 ** 60 }));
});

test("money is read exactly and rounded half up to the cent", () => {
  assert.equal(toCents("1500"), 150000);
  assert.equal(toCents("1500.1"), 150010);
  assert.equal(toCents(1500.1), 150010);
  assert.equal(toCents("1.005"), 101);
  assert.equal(toCents(1.005), 101); // a float just under 1.005
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents("0.004"), 0);
  assert.equal(toCents("-0.00"), 0);
  assert.equal(moneyString({ toString: () => "2500" }), "2500.00");
  for (const bad of ["", "abc", "1e3", "1,500", "NaN"]) assert.throws(() => toCents(bad), bad);
  assert.throws(() => toCents(Number.POSITIVE_INFINITY));
});

test("the hash ignores how amounts were written and the order items arrived in", () => {
  const base = snapshotHash(buildProposalSnapshot(input()));
  const reformatted = snapshotHash(
    buildProposalSnapshot(
      input({
        items: [
          { id: "a", description: "Discovery", amount: { toString: () => "500" }, sortOrder: 0 },
          { id: "b", description: "Theme build", amount: 1499.9999999, sortOrder: 1 },
        ],
        firstInvoice: { kind: "deposit", percent: 50, amount: 999.9999999999, currency: "GBP" },
        sentAt: "2026-11-01T09:30:00Z",
        expiresAt: new Date("2026-12-01T09:30:00Z"),
      }),
    ),
  );
  assert.equal(reformatted, base);
  assert.match(base, /^[0-9a-f]{64}$/);
});

test("items follow the proposal's order, ties broken by id", () => {
  const snapshot = buildProposalSnapshot(input());
  assert.deepEqual(
    snapshot.items.map((i) => i.description),
    ["Discovery", "Theme build"],
  );
  assert.equal(snapshot.total, "2000.00");
  const tied = buildProposalSnapshot(
    input({
      items: [
        { id: "z", description: "Second", amount: 1, sortOrder: 0 },
        { id: "y", description: "First", amount: 1, sortOrder: 0 },
      ],
    }),
  );
  assert.deepEqual(
    tied.items.map((i) => i.description),
    ["First", "Second"],
  );
});

test("any change to what was offered changes the hash", () => {
  const base = snapshotHash(buildProposalSnapshot(input()));
  const changes: Partial<SnapshotInput>[] = [
    { title: "Shopify store build!" },
    { terms: "Payment\n- 60% up front." },
    { intro: null },
    { currency: "USD" },
    { linkVersion: 3 },
    { depositPercent: 40 },
    { timelineWeeks: 7 },
    { recipient: { name: "Jane Cooper", email: "jane@other.co", company: "Verdant" } },
    { expiresAt: "2026-12-02T09:30:00.000Z" },
    { firstInvoice: { kind: "invoice", amount: 2000, currency: "GBP" } },
    {
      items: [
        { id: "a", description: "Discovery", amount: "500.01", sortOrder: 0 },
        { id: "b", description: "Theme build", amount: "1500.00", sortOrder: 1 },
      ],
    },
    {
      items: [
        { id: "a", description: "Discovery", amount: 500, sortOrder: 2 },
        { id: "b", description: "Theme build", amount: "1500.00", sortOrder: 1 },
      ],
    },
  ];
  for (const change of changes) {
    assert.notEqual(snapshotHash(buildProposalSnapshot(input(change))), base, JSON.stringify(change));
  }
});

test("Windows line endings and email case don't make a different document", () => {
  const unix = snapshotHash(buildProposalSnapshot(input()));
  const windows = snapshotHash(
    buildProposalSnapshot(
      input({
        intro: "Thanks for the call.\r\nHere's the plan.",
        terms: "Payment\r- 50% up front.",
        recipient: { name: "Jane Cooper", email: "jane@verdant.co", company: "Verdant" },
      }),
    ),
  );
  assert.equal(windows, unix);
});

test("a stored snapshot re-hashes to its hash after jsonb has reordered it", () => {
  const snapshot = buildProposalSnapshot(input());
  const hash = snapshotHash(snapshot);
  const stored = reverseKeys(JSON.parse(JSON.stringify(snapshot)));
  assert.equal(snapshotMatches(stored, hash), true);
  assert.deepEqual(parseSnapshot(stored), snapshot);
  assert.equal(snapshotMatches({ ...(stored as object), title: "Edited" }, hash), false);
  assert.equal(snapshotMatches("not a snapshot", hash), false);
});

test("the format is pinned: this exact document has always hashed to this", () => {
  // If this fails, the serializer changed and every stored signature with
  // snapshotVersion 1 would stop verifying. Add a new version instead.
  const snapshot = buildProposalSnapshot(input());
  assert.equal(snapshot.snapshotVersion, SNAPSHOT_VERSION);
  assert.equal(
    canonicalJson(snapshot),
    '{"agency":{"name":"Avix Digital"},"currency":"GBP","depositPercent":50,' +
      '"expiresAt":"2026-12-01T09:30:00.000Z","firstInvoice":{"amount":"1000.00","currency":"GBP","kind":"deposit","percent":50},' +
      '"intro":"Thanks for the call.\\nHere\'s the plan.","items":[{"amount":"500.00","description":"Discovery"},' +
      '{"amount":"1500.00","description":"Theme build"}],"linkVersion":2,"proposalId":"cmproposal123",' +
      '"recipient":{"company":"Verdant","email":"jane@verdant.co","name":"Jane Cooper"},' +
      '"sentAt":"2026-11-01T09:30:00.000Z","snapshotVersion":1,"terms":"Payment\\n- 50% up front.",' +
      '"timelineWeeks":6,"title":"Shopify store build","total":"2000.00"}',
  );
  // Independently: printf '%s' '<the string above>' | shasum -a 256
  assert.equal(snapshotHash(snapshot), "482f28216ed3698f927c37de48b27f2fd73fc0e8f66284f6f867eabd56fb1f61");
});

test("parseSnapshot refuses rows this version didn't write", () => {
  const snapshot = buildProposalSnapshot(input());
  assert.equal(parseSnapshot(null), null);
  assert.equal(parseSnapshot({ ...snapshot, snapshotVersion: 2 }), null);
  assert.equal(parseSnapshot({ ...snapshot, total: 2000 }), null);
  assert.equal(parseSnapshot({ ...snapshot, items: [{ description: "x", amount: "1.5" }] }), null);
  const { title: _title, ...untitled } = snapshot;
  void _title;
  assert.equal(parseSnapshot(untitled), null);
});

test("the document a page or PDF renders comes straight from the snapshot", () => {
  const doc = documentFromSnapshot(buildProposalSnapshot(input()));
  assert.deepEqual(
    doc.items.map((i) => [i.description, i.amount]),
    [
      ["Discovery", 500],
      ["Theme build", 1500],
    ],
  );
  assert.equal(doc.total, 2000);
  assert.deepEqual(doc.firstInvoice, { kind: "deposit", percent: 50, amount: 1000, currency: "GBP" });
  assert.equal(doc.preparedFor, "Verdant");
  const personal = documentFromSnapshot(
    buildProposalSnapshot(input({ recipient: { name: "Jane Cooper", email: null, company: null } })),
  );
  assert.equal(personal.preparedFor, "Jane Cooper");
});
