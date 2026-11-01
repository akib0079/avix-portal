import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AWAITING_RATING,
  AWAITING_REVIEW,
  INVOICE_TO_PAY,
  OPEN_REQUEST,
  PLAN_ITEM,
  TEAM_QUESTION,
  clientWaiting,
  hasTeamQuestion,
  isAwaitingRating,
  isAwaitingReview,
  isInvoiceToPay,
  isOpenRequest,
  isPlanItem,
} from "./work-scope";
import { pendingWork, projectHealth } from "./project-health";

type Item = {
  id: string;
  title: string;
  status: string;
  stage: string;
  position: number;
  parentId: string | null;
  archivedAt: string | null;
  clientApprovedAt: string | null;
  clientRating: number | null;
  openHelp: { client: number; team: number };
};

let n = 0;
function item(over: Partial<Item> = {}): Item {
  n++;
  const stage = over.stage ?? "TODO";
  return {
    id: `i${n}`,
    title: `Item ${n}`,
    status:
      stage === "IN_PROGRESS" ? "IN_PROGRESS" : stage === "REVIEW" || stage === "DONE" ? "COMPLETED" : "PENDING",
    stage,
    position: n,
    parentId: null,
    archivedAt: null,
    clientApprovedAt: null,
    clientRating: null,
    openHelp: { client: 0, team: 0 },
    ...over,
  };
}

test("each predicate matches its Prisma filter, field by field", () => {
  // The filters are what the database counts; the predicates are what the
  // pages count. They must describe the same rows.
  assert.deepEqual(PLAN_ITEM, { archivedAt: null, parentId: null, stage: { not: "REQUESTED" } });
  assert.deepEqual(OPEN_REQUEST, { archivedAt: null, stage: "REQUESTED" });
  assert.deepEqual(AWAITING_REVIEW, { archivedAt: null, stage: "REVIEW" });
  assert.deepEqual(TEAM_QUESTION, {
    archivedAt: null,
    comments: { some: { kind: "HELP", authorRole: "ADMIN", resolvedAt: null } },
  });
  assert.deepEqual(AWAITING_RATING, {
    archivedAt: null,
    parentId: null,
    stage: "DONE",
    clientApprovedAt: { not: null },
    clientRating: null,
  });

  const archived = { archivedAt: "2026-11-01T00:00:00Z" };
  assert.equal(isPlanItem(item()), true);
  assert.equal(isPlanItem(item({ parentId: "p" })), false);
  assert.equal(isPlanItem(item({ stage: "REQUESTED" })), false);
  assert.equal(isPlanItem(item(archived)), false);
  assert.equal(isOpenRequest(item({ stage: "REQUESTED" })), true);
  assert.equal(isOpenRequest(item({ stage: "REQUESTED", ...archived })), false);
  assert.equal(isAwaitingReview(item({ stage: "REVIEW", parentId: "p" })), true, "sub-items get reviewed too");
  assert.equal(isAwaitingReview(item({ stage: "DONE" })), false);
  assert.equal(hasTeamQuestion(item({ openHelp: { client: 0, team: 1 } })), true);
  assert.equal(hasTeamQuestion(item({ openHelp: { client: 2, team: 0 } })), false, "the client's own asks don't wait on them");
  const approved = { stage: "DONE", clientApprovedAt: "2026-11-01T00:00:00Z" };
  assert.equal(isAwaitingRating(item(approved)), true);
  assert.equal(isAwaitingRating(item({ ...approved, clientRating: 1 })), false);
  assert.equal(isAwaitingRating(item({ ...approved, parentId: "p" })), false, "phases and milestones are rated, not every task");
  assert.equal(isAwaitingRating(item({ stage: "DONE" })), false, "work the team closed alone doesn't ask for a rating");
});

test("what waits on the client, counted once", () => {
  const items = [
    item({ stage: "REVIEW" }),
    item({ stage: "REVIEW", openHelp: { client: 0, team: 1 } }),
    item({ stage: "TODO", openHelp: { client: 0, team: 2 } }),
    item({ stage: "DONE", clientApprovedAt: "2026-11-01T00:00:00Z" }),
    item({ stage: "REVIEW", archivedAt: "2026-11-01T00:00:00Z" }),
  ];
  assert.deepEqual(clientWaiting(items), { review: 2, questions: 2, rating: 1 });
});

test("progress counts the plan: top-level, live, accepted work", () => {
  const phase = item({ stage: "IN_PROGRESS", title: "Design" });
  const items = [
    item({ stage: "DONE" }),
    item({ stage: "REVIEW" }),
    phase,
    item({ stage: "TODO" }),
    item({ stage: "DONE", parentId: phase.id }),
    item({ stage: "DONE", parentId: phase.id }),
    item({ stage: "REQUESTED" }),
    item({ stage: "DONE", archivedAt: "2026-11-01T00:00:00Z" }),
  ];
  const health = projectHealth({ milestones: items, status: "IN_PROGRESS", now: new Date("2026-11-02") });
  assert.equal(health.total, 4);
  assert.equal(health.done, 2, "in review counts as done: the team has finished it");
  assert.equal(health.percent, 50);
  assert.equal(health.nextMilestone?.id, phase.id, "in progress beats the first not-started");

  // Callers that load the plan alone (no stage/parent fields) still work.
  const legacy = projectHealth({
    milestones: [
      { id: "a", title: "A", status: "COMPLETED" },
      { id: "b", title: "B", status: "PENDING" },
    ],
    status: "IN_PROGRESS",
  });
  assert.equal(legacy.percent, 50);
});

test("pending work reads the same rules", () => {
  const items = [
    item({ stage: "REVIEW" }),
    item({ stage: "REVIEW", parentId: "p" }),
    item({ stage: "DONE", clientApprovedAt: "2026-11-01T00:00:00Z" }),
    item({ stage: "REQUESTED" }),
    item({ stage: "REQUESTED", archivedAt: "2026-11-01T00:00:00Z" }),
  ];
  const pending = pendingWork({
    milestones: items,
    deliverables: [{ reviewStatus: null }, { reviewStatus: "CHANGES_REQUESTED" }],
    invoices: [
      { status: "SENT" },
      { status: "PAID" },
      // Drafts owe nothing yet; a claimed one waits on us, not the client.
      { status: "DRAFT" },
      { status: "IN_REVIEW", paymentClaimedAt: "2026-11-01T00:00:00Z" },
    ],
  });
  assert.deepEqual(pending, {
    milestonesAwaitingApproval: 2,
    milestonesAwaitingRating: 1,
    deliverablesAwaitingReview: 1,
    deliverablesNeedingChanges: 1,
    openRequests: 1,
    unpaidInvoices: 2,
    invoicesToPay: 1,
    total: 8,
  });
});

test("an invoice is the client's to pay once it's sent and until they report paying it", () => {
  assert.deepEqual(INVOICE_TO_PAY, {
    status: { in: ["SENT", "PARTIALLY_PAID"] },
    paymentClaimedAt: null,
  });
  // Never a draft, or one created but not sent: the client can't open those.
  for (const status of ["DRAFT", "ASSIGNED", "IN_REVIEW", "PAID", "CANCELLED"]) {
    assert.equal(isInvoiceToPay({ status }), false, status);
  }
  assert.equal(isInvoiceToPay({ status: "SENT" }), true);
  assert.equal(isInvoiceToPay({ status: "PARTIALLY_PAID", amount: 1000, amountPaid: 400 }), true);
  assert.equal(
    isInvoiceToPay({ status: "SENT", paymentClaimedAt: "2026-11-01T00:00:00Z" }),
    false,
    "reported paid: it waits on us now",
  );
  assert.equal(
    isInvoiceToPay({ status: "PARTIALLY_PAID", amount: 1000, amountPaid: 1000 }),
    false,
    "nothing left to pay",
  );
});
