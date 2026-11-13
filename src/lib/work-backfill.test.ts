import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FIRST_PASS_KEY, WORK_BACKFILL_SQL, backfillWorkItemsOnBoot, markFirstBoot } from "./work-backfill";
import { stageToStatus, stageWrite, statusToStage } from "./work-stage";

const MIGRATIONS = [
  "prisma/migrations/20261102120100_v49b_unified_work_backfill/migration.sql",
  "prisma/migrations/20261102134000_v49c_b4_legacy_repairs/migration.sql",
];
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

test("v49b then v49c run exactly the statements the boot-time pass runs", () => {
  assert.deepEqual(MIGRATIONS.flatMap(statementsOf), WORK_BACKFILL_SQL.map(unbounded));
});

test("only the steps that copy cards and comments are bounded to the last pass", () => {
  const bounded = WORK_BACKFILL_SQL.flatMap((sql, i) => (sql.includes("$1") ? [i + 1] : []));
  assert.deepEqual(bounded, [3, 4]);
});

test("the steps that link old invoice lines to work stop at the first boot pass", () => {
  const cut = WORK_BACKFILL_SQL.flatMap((sql, i) => (sql.includes(`'${FIRST_PASS_KEY}'`) ? [i + 1] : []));
  assert.deepEqual(cut, [16, 17]);
});

function fakeDb(last: string | null, linked = false) {
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
      findMany: async () => [
        ...(last == null ? [] : [{ key: "workBackfill:v49", value: last }]),
        ...(linked ? [{ key: "workBackfill:v49:linked", value: last ?? "" }] : []),
      ],
      createMany: async (args: unknown) => void calls.created.push(args),
      upsert: async (args: unknown) => void calls.stored.push(args),
    },
  };
  return { db, calls };
}

test("the first boot pass copies everything and records when it started", async () => {
  const before = Date.now();
  const bootedAt = new Date(before - 30_000);
  const { db, calls } = fakeDb(null);
  await backfillWorkItemsOnBoot(db, { bootedAt });
  const [stored] = calls.stored as { create: { key: string; value: string } }[];
  const started = stored.create.value;
  assert.ok(Date.parse(started) >= before && Date.parse(started) <= Date.now());
  // The cutover is the boot, not the (delayed) pass: the new code wrote
  // whatever came in between.
  assert.deepEqual(calls.created, [
    { data: [{ key: FIRST_PASS_KEY, value: bootedAt.toISOString() }], skipDuplicates: true },
    { data: [{ key: "workBackfill:v49:linked", value: started }], skipDuplicates: true },
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
  assert.deepEqual(calls.created[0], {
    data: [{ key: FIRST_PASS_KEY, value: last }],
    skipDuplicates: true,
  });
});

test("once a pass has linked old invoice lines, later passes leave the links alone", async () => {
  const last = "2026-11-02T08:00:00.000Z";
  const { db, calls } = fakeDb(last, true);
  const counts = await backfillWorkItemsOnBoot(db);
  assert.equal(counts.length, WORK_BACKFILL_SQL.length);
  assert.equal(calls.executed.length, WORK_BACKFILL_SQL.length - 2);
  assert.ok(calls.executed.every(({ sql }) => !sql.includes(`'${FIRST_PASS_KEY}'`)));
  // Nothing more to mark.
  assert.equal(calls.created.length, 1);
});

test("a pass that fails before the end links again next time", async () => {
  const { db, calls } = fakeDb("2026-11-02T08:00:00.000Z");
  db.$executeRawUnsafe = async () => {
    throw new Error("connection lost");
  };
  await assert.rejects(backfillWorkItemsOnBoot(db));
  assert.equal(calls.created.length, 1);
  assert.equal(calls.stored.length, 0);
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

test("the first boot is recorded at once, keeping an earlier pass's time", async () => {
  const { db, calls } = fakeDb(null);
  const bootedAt = new Date("2026-11-03T10:00:00.000Z");
  await markFirstBoot(db, bootedAt);
  assert.equal(calls.executed.length, 1);
  const [{ sql, values }] = calls.executed;
  assert.match(sql, /ON CONFLICT \("key"\) DO NOTHING/);
  assert.ok(sql.includes(`'${FIRST_PASS_KEY}'`) && sql.includes(`"key" = 'workBackfill:v49'`));
  assert.deepEqual(values, [bootedAt.toISOString()]);
});
