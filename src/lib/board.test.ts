import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectTaskStatus } from "@prisma/client";
import {
  BOARD_COLUMNS,
  MIN_POSITION_GAP,
  POSITION_STEP,
  approvalAfterMove,
  boardTaskHref,
  canMoveWorkItem,
  canSeePricing,
  dayKey,
  parentProblem,
  parseDay,
  placeInColumn,
  positionBetween,
  resolveWorkLink,
  workItemHref,
  workVersion,
  type WorkRole,
} from "./board";

const STAGES = BOARD_COLUMNS.map((c) => c.id);
const live = { archivedAt: null };

function allowed(role: WorkRole): string[] {
  const out: string[] = [];
  for (const from of STAGES) {
    for (const to of STAGES) {
      if (canMoveWorkItem({ role }, live, from, to).ok) out.push(`${from}>${to}`);
    }
  }
  return out;
}

test("a client can only approve or send back work that is in review", () => {
  assert.deepEqual(allowed("CLIENT").sort(), ["REVIEW>DONE", "REVIEW>IN_PROGRESS", "REVIEW>TODO"]);
  const approve = canMoveWorkItem({ role: "CLIENT" }, live, "REVIEW", "DONE");
  assert.deepEqual(approve, { ok: true, kind: "approve" });
  const back = canMoveWorkItem({ role: "CLIENT" }, live, "REVIEW", "IN_PROGRESS");
  assert.deepEqual(back, { ok: true, kind: "send-back" });
  // No reordering, not even inside review or their own requests.
  assert.equal(canMoveWorkItem({ role: "CLIENT" }, live, "REVIEW", "REVIEW").ok, false);
  assert.equal(canMoveWorkItem({ role: "CLIENT" }, live, "REQUESTED", "REQUESTED").ok, false);
  assert.equal(canMoveWorkItem({ role: "CLIENT" }, live, "TODO", "DONE").ok, false);
});

test("the team moves anything except into or out of Requested", () => {
  for (const role of ["ADMIN", "STAFF"] as const) {
    const moves = allowed(role);
    for (const from of STAGES) {
      for (const to of STAGES) {
        const crossesRequested = from !== to && (from === "REQUESTED" || to === "REQUESTED");
        assert.equal(moves.includes(`${from}>${to}`), !crossesRequested, `${role} ${from}>${to}`);
      }
    }
    assert.deepEqual(canMoveWorkItem({ role }, live, "TODO", "TODO"), { ok: true, kind: "reorder" });
    assert.deepEqual(canMoveWorkItem({ role }, live, "TODO", "REVIEW"), { ok: true, kind: "move" });
    const accept = canMoveWorkItem({ role }, live, "REQUESTED", "TODO");
    assert.equal(accept.ok, false);
    assert.match(accept.ok ? "" : accept.error, /Accept or decline/);
  }
});

test("archived work moves for nobody", () => {
  for (const role of ["ADMIN", "STAFF", "CLIENT"] as const) {
    for (const from of STAGES) {
      for (const to of STAGES) {
        assert.equal(canMoveWorkItem({ role }, { archivedAt: new Date() }, from, to).ok, false);
      }
    }
  }
});

test("approval: the client's Done approves, review and reopening clear it", () => {
  const t0 = new Date("2026-11-01T10:00:00Z");
  const t1 = new Date("2026-11-02T10:00:00Z");
  assert.equal(approvalAfterMove("DONE", "CLIENT", null, t1), t1);
  assert.equal(approvalAfterMove("DONE", "CLIENT", t0, t1), t0);
  assert.equal(approvalAfterMove("DONE", "ADMIN", null, t1), null);
  assert.equal(approvalAfterMove("DONE", "STAFF", t0, t1), t0);
  for (const to of ["REVIEW", "IN_PROGRESS", "TODO", "BACKLOG"] as ProjectTaskStatus[]) {
    assert.equal(approvalAfterMove(to, "ADMIN", t0, t1), null, to);
  }
});

test("phases are one level deep, on the same project", () => {
  const parent = {
    id: "p",
    projectId: "proj",
    parentId: null,
    stage: "IN_PROGRESS" as const,
    archivedAt: null,
  };
  const item = { id: "i", childCount: 0 };
  assert.equal(parentProblem(item, parent, "proj"), null);
  assert.equal(parentProblem({ childCount: 0 }, parent, "proj"), null, "a new item");
  assert.match(parentProblem(item, null, "proj")!, /isn't on this project/);
  assert.match(parentProblem(item, { ...parent, projectId: "other" }, "proj")!, /isn't on this project/);
  assert.match(parentProblem({ id: "p", childCount: 0 }, parent, "proj")!, /itself/);
  assert.match(parentProblem(item, { ...parent, parentId: "grand" }, "proj")!, /one level/);
  assert.match(parentProblem(item, { ...parent, archivedAt: new Date() }, "proj")!, /archived/);
  assert.match(parentProblem(item, { ...parent, stage: "REQUESTED" }, "proj")!, /Accept/);
  assert.match(parentProblem({ id: "i", childCount: 2 }, parent, "proj")!, /sub-items/);
});

test("positions between neighbours stay above zero", () => {
  assert.equal(positionBetween(), POSITION_STEP);
  assert.equal(positionBetween(null, 1024), 512);
  assert.equal(positionBetween(1024, null), 2048);
  assert.equal(positionBetween(1024, 2048), 1536);
  let top = 1024;
  for (let i = 0; i < 60; i++) top = positionBetween(null, top);
  assert.ok(top > 0);
});

test("a drop writes one row while there is room", () => {
  const column = [
    { id: "a", boardPosition: 1024 },
    { id: "b", boardPosition: 2048 },
  ];
  assert.deepEqual(placeInColumn(column, "x", 1536), [{ id: "x", boardPosition: 1536 }]);
  assert.deepEqual(placeInColumn([], "x", 1024), [{ id: "x", boardPosition: 1024 }]);
});

test("a drop onto a hidden card goes just past it instead of renumbering", () => {
  const column = [
    { id: "a", boardPosition: 1024 },
    { id: "b", boardPosition: 2048 },
    { id: "c", boardPosition: 3072 },
  ];
  // A filter hides b: the drop between a and c lands exactly on it.
  assert.deepEqual(placeInColumn(column, "x", 2048), [{ id: "x", boardPosition: 1536 }]);
  // Just above b goes above it.
  assert.deepEqual(placeInColumn(column, "x", 2048 + MIN_POSITION_GAP / 4), [
    { id: "x", boardPosition: 2560 },
  ]);
  // On the first card, halfway to zero.
  assert.deepEqual(placeInColumn(column, "x", 1024), [{ id: "x", boardPosition: 512 }]);
  // No room beside the card: renumber.
  const tight = [
    { id: "a", boardPosition: 1024 },
    { id: "b", boardPosition: 1024 + MIN_POSITION_GAP * 1.5 },
  ];
  assert.equal(placeInColumn(tight, "x", 1024 + MIN_POSITION_GAP * 1.5).length > 1, true);
  // Two cards at the same number are a run, not one card: renumber.
  const tied = [
    { id: "a", boardPosition: 1024 },
    { id: "b", boardPosition: 1024 },
  ];
  assert.deepEqual(placeInColumn(tied, "x", 1024), [
    { id: "x", boardPosition: 1024 },
    { id: "a", boardPosition: 2048 },
    { id: "b", boardPosition: 3072 },
  ]);
});

test("a drop renumbers the column when the spot is worn out or not above zero", () => {
  const column = [
    { id: "a", boardPosition: 1024 },
    { id: "b", boardPosition: 1024 + MIN_POSITION_GAP / 4 },
    { id: "c", boardPosition: 4096 },
  ];
  // Between a and b, where there is no room left.
  const rows = placeInColumn(column, "x", 1024 + MIN_POSITION_GAP / 8);
  const order = new Map(rows.map((r) => [r.id, r.boardPosition]));
  assert.equal(order.get("x"), 2048);
  assert.equal(order.get("b"), 3072);
  assert.equal(order.has("a"), false, "a already sits at 1024");
  assert.equal(order.get("c"), undefined, "c already sits at 4096");

  // Worn out at the very end: only the moved item needs a new number.
  const end = placeInColumn(
    [
      { id: "a", boardPosition: 1024 },
      { id: "b", boardPosition: 2048 },
    ],
    "x",
    2048 + MIN_POSITION_GAP / 10,
  );
  assert.deepEqual(end, [{ id: "x", boardPosition: 3072 }]);

  // 0 is reserved for "never placed".
  const top = placeInColumn(column.slice(0, 1), "x", 0);
  assert.deepEqual(top, [
    { id: "x", boardPosition: 1024 },
    { id: "a", boardPosition: 2048 },
  ]);
  const bad = placeInColumn(column.slice(0, 1), "x", Number.NaN);
  assert.deepEqual(bad, [{ id: "x", boardPosition: 2048 }]);
  // The moved item is ignored if it was left in the column.
  assert.deepEqual(placeInColumn([{ id: "x", boardPosition: 5 }], "x", 1024), [
    { id: "x", boardPosition: 1024 },
  ]);
});

test("calendar days are UTC midnight and round-trip", () => {
  const d = parseDay("2026-03-29");
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString(), "2026-03-29T00:00:00.000Z");
  assert.equal(dayKey(d), "2026-03-29");
  assert.equal(parseDay(undefined), undefined);
  assert.equal(parseDay(null), null);
  assert.equal(parseDay(""), null);
  assert.equal(parseDay("2026-02-31"), null);
  assert.equal(parseDay("29/03/2026"), null);
});

test("only the admin and a non-contract client see prices", () => {
  assert.equal(canSeePricing("ADMIN", "CONTRACT"), true);
  assert.equal(canSeePricing("CLIENT", "MILESTONE"), true);
  assert.equal(canSeePricing("CLIENT", "CONTRACT"), false);
  assert.equal(canSeePricing("STAFF", "MILESTONE"), false);
});

test("deep links open the Milestones tab with the item", () => {
  assert.equal(
    workItemHref("p1", "m1", "ADMIN"),
    "/admin/projects/p1?tab=milestones&view=board&item=m1",
  );
  assert.equal(
    workItemHref("p1", "m1", "CLIENT", "list"),
    "/portal/projects/p1?tab=milestones&view=list&item=m1",
  );
  assert.equal(workItemHref("p1", null, "CLIENT"), "/portal/projects/p1?tab=milestones&view=board");
  assert.equal(boardTaskHref("ADMIN", "p1", "m1"), workItemHref("p1", "m1", "ADMIN", "board"));
});

test("old links keep resolving", () => {
  const link = (query: string) => resolveWorkLink(new URLSearchParams(query));
  assert.deepEqual(link("tab=milestones&view=board&item=m1"), {
    tab: "milestones",
    view: "board",
    itemId: "m1",
  });
  assert.deepEqual(link("tab=board&task=m1"), { tab: "milestones", view: "board", itemId: "m1" });
  assert.deepEqual(link("tab=board"), { tab: "milestones", view: "board", itemId: null });
  assert.deepEqual(link("tab=milestones"), { tab: "milestones", view: "list", itemId: null });
  // The admin's Requests tab folded into the list, where requests are decided.
  assert.deepEqual(link("tab=requests"), { tab: "milestones", view: "list", itemId: null });
  assert.deepEqual(link("tab=requests&item=m1"), { tab: "milestones", view: "list", itemId: "m1" });
  assert.deepEqual(link("view=board&task=m1"), { tab: "milestones", view: "board", itemId: "m1" });
  assert.deepEqual(link("view=timeline"), { tab: "milestones", view: "list", itemId: null });
  assert.deepEqual(link("view=files"), { tab: "files", view: null, itemId: null });
  assert.deepEqual(link("view=billing"), { tab: "billing", view: null, itemId: null });
  assert.deepEqual(link("task=m1"), { tab: "milestones", view: null, itemId: "m1" });
  assert.deepEqual(link("view=list"), { tab: "milestones", view: "list", itemId: null });
  assert.deepEqual(link("tab=money"), { tab: "money", view: null, itemId: null });
  assert.deepEqual(link(""), { tab: null, view: null, itemId: null });
});

test("the change token moves with anything a card shows", () => {
  const row = {
    itemsAt: new Date("2026-11-02T10:00:00Z"),
    items: 12,
    commentsAt: new Date("2026-11-02T09:00:00Z"),
    comments: 4,
    hours: 7.5,
    hoursMix: 7.5 * 1000,
    entries: 3,
    billedAt: null,
    billed: 0,
  };
  const base = workVersion(row, { billing: false });
  assert.equal(workVersion({ ...row }, { billing: false }), base);
  const changes: Partial<typeof row>[] = [
    { itemsAt: new Date("2026-11-02T10:00:01Z") },
    { items: 11 },
    { commentsAt: new Date("2026-11-02T09:30:00Z") },
    { comments: 3 },
    { hours: 7.75 },
    // The same hours, moved to another item.
    { hoursMix: 7.5 * 2000 },
    { entries: 4 },
  ];
  for (const change of changes) {
    assert.notEqual(workVersion({ ...row, ...change }, { billing: false }), base, JSON.stringify(change));
  }
  // Billing only counts for the admin's token.
  const billed = { ...row, billed: 2, billedAt: new Date() };
  assert.equal(workVersion(billed, { billing: false }), base);
  assert.notEqual(workVersion(billed, { billing: true }), workVersion(row, { billing: true }));
  const empty = workVersion(
    { itemsAt: null, items: 0, commentsAt: null, comments: 0, hours: 0, hoursMix: 0, entries: 0, billedAt: null, billed: 0 },
    { billing: true },
  );
  assert.equal(empty, "0.0.0.0.0.0.0.0.0");
});
