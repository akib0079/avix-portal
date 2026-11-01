import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectTaskStatus } from "@prisma/client";
import type { BoardPerson, WorkItem } from "./board";
import { stageToStatus } from "./work-stage";
import {
  WITHDRAWN_NOTE,
  assigneeGroups,
  endOfColumn,
  formatHours,
  hoursProgress,
  phaseProgress,
  planOrder,
  planTree,
  reorderPlan,
  requestLabel,
  requestOutcome,
  stageChoices,
  stageGroups,
  withPlanPositions,
} from "./work-list";

let n = 0;
function item(over: Partial<WorkItem> = {}): WorkItem {
  n++;
  const stage: ProjectTaskStatus = over.stage ?? "TODO";
  return {
    id: `i${n}`,
    title: `Item ${n}`,
    stage,
    status: stageToStatus(stage),
    position: n,
    boardPosition: n * 1024,
    priority: null,
    dueDate: null,
    parentId: null,
    childCount: 0,
    assigneeId: null,
    assignee: null,
    createdById: null,
    createdByRole: "ADMIN",
    creatorName: null,
    hasDescription: false,
    commentCount: 0,
    openHelp: { client: 0, team: 0 },
    helpFrom: null,
    loggedHours: 0,
    estimatedHours: null,
    pricingType: "NONE",
    hourlyRate: null,
    fixedPrice: null,
    billedOn: [],
    completedAt: null,
    clientApprovedAt: null,
    clientRating: null,
    clientRatingNote: null,
    sourceTaskRequestId: null,
    archivedAt: null,
    createdAt: `2026-10-${String(10 + (n % 18)).padStart(2, "0")}T00:00:00.000Z`,
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

const ids = (list: { id: string }[]) => list.map((i) => i.id);

test("the plan: phases hold their work, requests wait apart, nothing goes missing", () => {
  const design = item({ id: "design", position: 0 });
  const launch = item({ id: "launch", position: 3 });
  const logo = item({ id: "logo", position: 2, parentId: "design" });
  const colours = item({ id: "colours", position: 1, parentId: "design" });
  const ask = item({ id: "ask", position: 4, stage: "REQUESTED", parentId: "design" });
  const orphan = item({ id: "orphan", position: 5, parentId: "gone" });
  const old = item({ id: "old", position: 6, archivedAt: "2026-10-01T00:00:00.000Z" });

  const tree = planTree([launch, logo, ask, design, orphan, colours, old]);
  assert.deepEqual(ids(tree.requested), ["ask"], "a waiting request isn't plan work yet");
  assert.deepEqual(
    tree.rows.map((r) => [r.item.id, ids(r.children)]),
    [
      ["design", ["colours", "logo"]],
      ["launch", []],
      // Its phase isn't live any more: shown at the top level, not dropped.
      ["orphan", []],
    ],
  );
  // Each phase is followed by its work, then the requests: what
  // reorderMilestones writes, covering every live item exactly once.
  assert.deepEqual(planOrder(tree), ["design", "colours", "logo", "launch", "orphan", "ask"]);
});

test("one level deep: work under a sub-item still shows", () => {
  const phase = item({ id: "phase", position: 0 });
  const child = item({ id: "child", position: 1, parentId: "phase" });
  const deeper = item({ id: "deeper", position: 2, parentId: "child" });
  const tree = planTree([phase, child, deeper]);
  assert.deepEqual(
    tree.rows.map((r) => [r.item.id, ids(r.children)]),
    [
      ["phase", ["child"]],
      ["deeper", []],
    ],
  );
});

test("dragging reorders siblings only", () => {
  const a = item({ id: "a", position: 0 });
  const b = item({ id: "b", position: 1 });
  const c = item({ id: "c", position: 2 });
  const b1 = item({ id: "b1", position: 3, parentId: "b" });
  const b2 = item({ id: "b2", position: 4, parentId: "b" });
  const c1 = item({ id: "c1", position: 5, parentId: "c" });
  const tree = planTree([a, b, c, b1, b2, c1]);

  const moved = reorderPlan(tree, "c", "a")!;
  assert.deepEqual(planOrder(moved), ["c", "c1", "a", "b", "b1", "b2"], "a phase moves with its work");

  const inside = reorderPlan(tree, "b2", "b1")!;
  assert.deepEqual(planOrder(inside), ["a", "b", "b2", "b1", "c", "c1"]);

  assert.equal(reorderPlan(tree, "b1", "c1"), null, "into another phase is the phase picker's job");
  assert.equal(reorderPlan(tree, "b1", "a"), null, "out to the top level too");
  assert.equal(reorderPlan(tree, "a", "a"), null);

  const items = withPlanPositions([a, b, c, b1, b2, c1], planOrder(moved));
  assert.deepEqual(
    items.map((i) => [i.id, i.position]),
    [
      ["a", 2],
      ["b", 3],
      ["c", 0],
      ["b1", 4],
      ["b2", 5],
      ["c1", 1],
    ],
  );
  const unchanged = withPlanPositions([a], ["a"]);
  assert.equal(unchanged[0], a, "untouched rows keep their identity");
});

test("a phase's progress counts finished work, review included", () => {
  assert.deepEqual(phaseProgress([]), { done: 0, total: 0, percent: 0 });
  assert.deepEqual(
    phaseProgress([{ stage: "DONE" }, { stage: "REVIEW" }, { stage: "IN_PROGRESS" }, { stage: "TODO" }, { stage: "BACKLOG" }]),
    { done: 2, total: 5, percent: 40 },
  );
});

test("grouped by stage, the list reads like the board on its side", () => {
  const late = item({ stage: "TODO", boardPosition: 5000 });
  const early = item({ stage: "TODO", boardPosition: 100 });
  const review = item({ stage: "REVIEW" });
  const asked = item({ stage: "REQUESTED" });
  const gone = item({ stage: "DONE", archivedAt: "2026-10-01T00:00:00.000Z" });
  const team = stageGroups([late, early, review, asked, gone], "ADMIN");
  assert.deepEqual(
    team.map((g) => [g.key, g.label, ids(g.items)]),
    [
      ["TODO", "To do", [early.id, late.id]],
      ["REVIEW", "In review", [review.id]],
    ],
  );
  assert.equal(stageGroups([review], "CLIENT")[0]!.label, "Your review");
});

test("grouped by assignee: people in board order, then unassigned", () => {
  const people: BoardPerson[] = [
    { id: "akib", name: "Akib", role: "ADMIN" },
    { id: "sam", name: "Sam", role: "STAFF" },
    { id: "jane", name: "Jane", role: "CLIENT" },
  ];
  const free = item({ position: 0 });
  const forJane = item({ position: 1, assigneeId: "jane" });
  const forAkib = item({ position: 2, assigneeId: "akib" });
  const gone = item({
    position: 3,
    assigneeId: "left",
    assignee: { id: "left", name: "Former Staff", image: null },
  });
  const asked = item({ position: 4, stage: "REQUESTED", assigneeId: "sam" });
  const groups = assigneeGroups([free, forJane, forAkib, gone, asked], people);
  assert.deepEqual(
    groups.map((g) => [g.key, g.label, ids(g.items)]),
    [
      ["akib", "Akib", [forAkib.id]],
      ["jane", "Jane", [forJane.id]],
      ["left", "Former Staff", [gone.id]],
      ["unassigned", "Unassigned", [free.id]],
    ],
  );
});

test("hours: a bar only against an estimate the viewer may see", () => {
  assert.deepEqual(hoursProgress(3, null), { ratio: null, over: false });
  assert.deepEqual(hoursProgress(3, 0), { ratio: null, over: false });
  assert.deepEqual(hoursProgress(3, 4), { ratio: 0.75, over: false });
  assert.deepEqual(hoursProgress(6, 4), { ratio: 1.5, over: true });
  assert.equal(formatHours(2), "2h");
  assert.equal(formatHours(2.25), "2.3h");
});

test("stage menus offer exactly the moves the server accepts", () => {
  const todo = { stage: "TODO" as const, archivedAt: null };
  assert.deepEqual(stageChoices("ADMIN", todo), ["BACKLOG", "IN_PROGRESS", "REVIEW", "DONE"]);
  assert.deepEqual(stageChoices("STAFF", todo), ["BACKLOG", "IN_PROGRESS", "REVIEW", "DONE"]);
  assert.deepEqual(stageChoices("CLIENT", todo), []);
  assert.deepEqual(stageChoices("CLIENT", { stage: "REVIEW", archivedAt: null }), ["TODO", "IN_PROGRESS", "DONE"]);
  assert.deepEqual(stageChoices("ADMIN", { stage: "REQUESTED", archivedAt: null }), [], "accept or decline instead");
  assert.deepEqual(stageChoices("ADMIN", { stage: "TODO", archivedAt: "2026-10-01" }), []);
});

test("the end of a column is a step past its last live card", () => {
  const a = item({ id: "a", stage: "DONE", boardPosition: 2048 });
  const b = item({ id: "b", stage: "DONE", boardPosition: 4096 });
  const gone = item({ stage: "DONE", boardPosition: 9999, archivedAt: "2026-10-01" });
  assert.equal(endOfColumn([a, b, gone], "DONE"), 4096 + 1024);
  assert.equal(endOfColumn([a, b], "DONE", "b"), 2048 + 1024, "leaving out the card that moves");
  assert.equal(endOfColumn([a, b], "TODO"), 1024);
});

test("a request's history line follows its work", () => {
  const live = (stage: ProjectTaskStatus) => ({ stage, archivedAt: null });
  const pending = { status: "PENDING" as const, adminNote: null };
  const approved = { status: "APPROVED" as const, adminNote: null };

  assert.equal(requestLabel(requestOutcome(pending, live("REQUESTED")), "CLIENT"), "Waiting for the team");
  assert.equal(requestLabel(requestOutcome(approved, live("IN_PROGRESS")), "CLIENT"), "Accepted, in progress");
  assert.equal(requestLabel(requestOutcome(approved, live("REVIEW")), "CLIENT"), "Accepted, ready for your review");
  assert.equal(requestLabel(requestOutcome(approved, live("IN_PROGRESS")), "ADMIN"), "Accepted · In progress");
  assert.deepEqual(
    requestOutcome(approved, { stage: "DONE", archivedAt: "2026-10-01" }),
    { kind: "closed" },
    "archived since",
  );
  assert.deepEqual(requestOutcome(approved, null), { kind: "closed" }, "a pre-v49 request with no item");

  const declined = requestOutcome({ status: "REJECTED", adminNote: "Out of scope" }, null);
  assert.deepEqual(declined, { kind: "declined", note: "Out of scope" });
  assert.equal(requestLabel(declined, "CLIENT"), "Declined");
  const withdrawn = requestOutcome({ status: "REJECTED", adminNote: WITHDRAWN_NOTE }, null);
  assert.deepEqual(withdrawn, { kind: "withdrawn" });
  assert.equal(requestLabel(withdrawn, "CLIENT"), "You withdrew it");
});
