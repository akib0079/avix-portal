import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FIRST_PASS_KEY, WORK_BACKFILL_SQL, backfillWorkItemsOnBoot } from "./work-backfill";
import { stageToStatus, stageWrite, statusToStage } from "./work-stage";

const MIGRATIONS = ["prisma/migrations/20261102120100_v49b_unified_work_backfill/migration.sql"];
const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();
/** The boot pass's own bound on the copying steps; the migrations copy everything. */
const unbounded = (sql: string) => squash(sql).replace(/ (?:AND|WHERE) [a-z]\."createdAt" > \$1/, "");

function statementsOf(path: string): string[] {
  const body = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n");
  return body.split(/;\s*(?:\n|$)/).map(squash).filter(Boolean);
}

test("the migrations run exactly the statements the boot-time pass runs", () => {
  assert.deepEqual(MIGRATIONS.flatMap(statementsOf), WORK_BACKFILL_SQL.map(unbounded));
});

test("only the steps that copy cards and comments are bounded to the last pass", () => {
  const bounded = WORK_BACKFILL_SQL.flatMap((sql, i) => (sql.includes("$1") ? [i + 1] : []));
  assert.deepEqual(bounded, [3, 4]);
});

function fakeDb(last: string | null) {
  const calls = {
    executed: [] as { sql: string; values: unknown[] }[],
    created: [] as unknown[],
    stored: [] as unknown[],
  };
  const db = {
    $executeRawUnsafe: async (sql: string, ...values: unknown[]) => {
      calls.executed.push({ sql, values });
      return 0;
    },
    appSetting: {
      findUnique: async () => (last == null ? null : { value: last }),
      createMany: async (args: unknown) => void calls.created.push(args),
      upsert: async (args: unknown) => void calls.stored.push(args),
    },
  };
  return { db, calls };
}

test("the first boot pass copies everything and records when it started", async () => {
  const before = Date.now();
  const { db, calls } = fakeDb(null);
  await backfillWorkItemsOnBoot(db);
  const [stored] = calls.stored as { create: { key: string; value: string } }[];
  const started = stored.create.value;
  assert.ok(Date.parse(started) >= before && Date.parse(started) <= Date.now());
  assert.deepEqual(calls.created, [
    { data: [{ key: FIRST_PASS_KEY, value: started }], skipDuplicates: true },
  ]);
  assert.equal(calls.executed.length, WORK_BACKFILL_SQL.length);
  for (const { sql, values } of calls.executed) {
    assert.deepEqual(values, sql.includes("$1") ? [new Date(0)] : []);
  }
});

test("a later pass picks up where the last one started", async () => {
  const last = "2026-11-02T08:00:00.000Z";
  const { db, calls } = fakeDb(last);
  await backfillWorkItemsOnBoot(db);
  const copying = calls.executed.filter(({ sql }) => sql.includes("$1"));
  assert.deepEqual(
    copying.map(({ values }) => values),
    [[new Date(last)], [new Date(last)]],
  );
  // The first pass's time is only ever written once: this insert skips an existing row.
  assert.deepEqual(calls.created, [
    { data: [{ key: FIRST_PASS_KEY, value: last }], skipDuplicates: true },
  ]);
});

test("stage and status stay in step", () => {
  assert.equal(stageToStatus("REQUESTED"), "PENDING");
  assert.equal(stageToStatus("BACKLOG"), "PENDING");
  assert.equal(stageToStatus("REVIEW"), "COMPLETED");
  for (const status of ["PENDING", "IN_PROGRESS", "COMPLETED"] as const) {
    assert.equal(stageToStatus(statusToStage(status)), status);
  }
});

test("completedAt is stamped on finishing, kept between review and done, cleared on reopening", () => {
  const t0 = new Date("2026-11-01T10:00:00Z");
  const t1 = new Date("2026-11-02T10:00:00Z");
  const review = stageWrite("REVIEW", { stage: "IN_PROGRESS", completedAt: null }, t0);
  assert.deepEqual(review, { stage: "REVIEW", status: "COMPLETED", completedAt: t0 });
  assert.equal(stageWrite("DONE", review, t1).completedAt, t0);
  assert.equal(stageWrite("TODO", review, t1).completedAt, null);
});
