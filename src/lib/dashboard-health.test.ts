import assert from "node:assert/strict";
import { test } from "node:test";
import { paidTrend, projectFlags, toTopClients, type TopClientRow } from "./dashboard-health";

const DAY = 86_400_000;

test("paidTrend: six months oldest first, outside the window ignored", () => {
  const now = new Date(2026, 6, 15);
  const trend = paidTrend(
    [
      { amountUsd: 100, issueDate: new Date(2026, 6, 1) },
      { amountUsd: 50, issueDate: new Date(2026, 6, 30) },
      { amountUsd: 20, issueDate: new Date(2026, 1, 3) },
      { amountUsd: 999, issueDate: new Date(2026, 0, 31) },
    ],
    now,
  );
  assert.deepEqual(
    trend.map((p) => p.label),
    ["Feb", "Mar", "Apr", "May", "Jun", "Jul"],
  );
  assert.deepEqual(
    trend.map((p) => p.amount),
    [20, 0, 0, 0, 0, 150],
  );
});

test("projectFlags: late before stale, a project both late and stale shows once", () => {
  const now = new Date(2026, 6, 15);
  const client = { firstName: "Ada", lastName: "Lane" };
  const flags = projectFlags(
    [{ id: "p1", projectName: "One", dueDate: new Date(2026, 6, 1), client }],
    [
      { id: "p1", projectName: "One", updatedAt: new Date(now.getTime() - 20 * DAY), client },
      { id: "p2", projectName: "Two", updatedAt: new Date(now.getTime() - 15 * DAY), client: null },
    ],
    now,
  );
  assert.deepEqual(flags, [
    { id: "p1", name: "One", clientName: "Ada Lane", reason: "past due Jul 1", kind: "late" },
    { id: "p2", name: "Two", clientName: null, reason: "no activity in 15 days", kind: "stale" },
  ]);
});

test("projectFlags: at most six", () => {
  const now = new Date(2026, 6, 15);
  const late = Array.from({ length: 5 }, (_, i) => ({
    id: `l${i}`,
    projectName: `L${i}`,
    dueDate: new Date(2026, 6, 1),
    client: null,
  }));
  const stale = Array.from({ length: 5 }, (_, i) => ({
    id: `s${i}`,
    projectName: `S${i}`,
    updatedAt: new Date(2026, 5, 1),
    client: null,
  }));
  const flags = projectFlags(late, stale, now);
  assert.equal(flags.length, 6);
  assert.deepEqual(
    flags.map((f) => f.id),
    ["l0", "l1", "l2", "l3", "l4", "s0"],
  );
});

test("toTopClients: keeps the ranked order on ties, names and quiet days", () => {
  const now = new Date("2026-07-15T12:00:00Z");
  const row = (o: Partial<TopClientRow>): TopClientRow => ({
    id: "x",
    firstName: "",
    lastName: "",
    company: null,
    collected: 0,
    lastContact: null,
    ...o,
  });
  const out = toTopClients(
    [
      row({ id: "a", company: "Acme", collected: 500, lastContact: new Date("2026-07-15T08:00:00Z") }),
      row({ id: "b", firstName: "Bo", lastName: "Ray", collected: 500, lastContact: new Date("2026-07-05T12:00:00Z") }),
      row({ id: "c", collected: null }),
    ],
    now,
  );
  assert.deepEqual(out, [
    { id: "a", name: "Acme", collected: 500, lastContactDays: 0 },
    { id: "b", name: "Bo Ray", collected: 500, lastContactDays: 10 },
    { id: "c", name: "Client", collected: 0, lastContactDays: null },
  ]);
});
