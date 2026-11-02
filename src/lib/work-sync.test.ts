import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectTaskStatus } from "@prisma/client";
import type { BoardPerson, WorkItem } from "./board";
import { stageToStatus } from "./work-stage";
import { acceptedItem } from "./work-sync";

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
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

const people: BoardPerson[] = [
  { id: "sam", name: "Sam Team", role: "STAFF" },
  { id: "ava", name: "Ava Admin", role: "ADMIN" },
];

/** A request as the client sent it: pinned, dated, under a phase, and priced by an admin since. */
function request() {
  return item({
    stage: "REQUESTED",
    sourceTaskRequestId: "req1",
    assigneeId: "sam",
    assignee: { id: "sam", name: "Sam Team", image: "/sam.png" },
    dueDate: "2026-11-20",
    parentId: "launch",
    pricingType: "FIXED",
    fixedPrice: 1500,
  });
}

test("accepting with only a stage keeps the pin, the date, the phase and the price", () => {
  const before = request();
  const after = acceptedItem(before, { stage: "TODO" }, { boardPosition: 4096, people, priced: true });
  assert.equal(after.stage, "TODO");
  assert.equal(after.status, "PENDING");
  assert.equal(after.boardPosition, 4096);
  assert.equal(after.assigneeId, "sam");
  assert.deepEqual(after.assignee, before.assignee);
  assert.equal(after.dueDate, "2026-11-20");
  assert.equal(after.parentId, "launch");
  assert.equal(after.pricingType, "FIXED");
  assert.equal(after.fixedPrice, 1500);
});

test("what the accepter changed is painted; null clears", () => {
  const after = acceptedItem(
    request(),
    { stage: "IN_PROGRESS", assigneeId: "ava", dueDate: null, parentId: null },
    { boardPosition: 1024, people, priced: true },
  );
  assert.equal(after.status, "IN_PROGRESS");
  assert.equal(after.assigneeId, "ava");
  assert.deepEqual(after.assignee, { id: "ava", name: "Ava Admin", image: null });
  assert.equal(after.dueDate, null);
  assert.equal(after.parentId, null);

  const unpinned = acceptedItem(request(), { stage: "TODO", assigneeId: null }, { boardPosition: 1, people, priced: true });
  assert.equal(unpinned.assigneeId, null);
  assert.equal(unpinned.assignee, null);
});

test("a new price replaces the old one whole; staff never paint a price", () => {
  const hourly = acceptedItem(
    request(),
    { stage: "TODO", pricingType: "HOURLY", hourlyRate: 80, estimatedHours: 5, fixedPrice: 999 },
    { boardPosition: 1, people, priced: true },
  );
  assert.equal(hourly.pricingType, "HOURLY");
  assert.equal(hourly.hourlyRate, 80);
  assert.equal(hourly.estimatedHours, 5);
  assert.equal(hourly.fixedPrice, null, "fields of another type are cleared");

  const none = acceptedItem(request(), { stage: "TODO", pricingType: "NONE" }, { boardPosition: 1, people, priced: true });
  assert.equal(none.pricingType, "NONE");
  assert.equal(none.fixedPrice, null);

  const staffView = item({ stage: "REQUESTED" });
  const byStaff = acceptedItem(
    staffView,
    { stage: "TODO", pricingType: "FIXED", fixedPrice: 10 },
    { boardPosition: 1, people, priced: false },
  );
  assert.equal(byStaff.pricingType, "NONE");
  assert.equal(byStaff.fixedPrice, null);
});
