import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { WORK_BACKFILL_SQL } from "./work-backfill";
import { stageToStatus, stageWrite, statusToStage } from "./work-stage";

const MIGRATION = "prisma/migrations/20261102120100_v49b_unified_work_backfill/migration.sql";
const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();

test("the v49b migration runs exactly the statements the boot-time pass runs", () => {
  const body = readFileSync(MIGRATION, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n");
  const statements = body.split(/;\s*(?:\n|$)/).map(squash).filter(Boolean);
  assert.deepEqual(statements, WORK_BACKFILL_SQL.map(squash));
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
