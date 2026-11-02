/**
 * v49 made Milestone the one work item: the v48 board cards (project_tasks),
 * their comments and any pending client requests move into milestones. These
 * statements ship as the v49b migration, and run again every time the new
 * code boots, to catch rows an older build wrote since the last pass: between
 * `migrate deploy` and the new build taking traffic (Hostinger builds take
 * minutes, with the old app still serving), or while a rollback had it
 * serving again. Every statement only matches rows still in the shape the old
 * code writes, so it is safe to repeat.
 *
 * Keep in step with
 * prisma/migrations/20261102120100_v49b_unified_work_backfill/migration.sql
 * (steps 1–7) and 20261102134000_v49c_b4_legacy_repairs (the rest) —
 * work-backfill.test.ts fails if they drift. Only the boot pass bounds
 * steps 3 and 4 to rows created since the last pass ($1): cards and comments
 * the new code has deleted since must not come back.
 */
export const WORK_BACKFILL_SQL: readonly string[] = [
  // 1. Place the existing milestones on the board. boardPosition = 0 marks a
  //    row nobody has placed yet; the new code never writes 0. Finished work
  //    the client hasn't approved goes to the review column, unless it is more
  //    than 30 days old, so stale items don't come back as fresh asks.
  `UPDATE "milestones" m SET
  "stage" = (CASE
    WHEN m."status" = 'PENDING' THEN 'TODO'
    WHEN m."status" = 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN m."clientApprovedAt" IS NULL AND p."clientId" IS NOT NULL
      AND m."updatedAt" > now() - interval '30 days' THEN 'REVIEW'
    ELSE 'DONE'
  END)::"ProjectTaskStatus",
  "boardPosition" = (m."position" + 1) * 1024,
  "completedAt" = CASE WHEN m."status" = 'COMPLETED'
    THEN COALESCE(m."completedAt", m."clientApprovedAt", m."updatedAt") END,
  "createdByRole" = (CASE WHEN m."sourceTaskRequestId" IS NOT NULL
    THEN 'CLIENT' ELSE 'ADMIN' END)::"MessageSenderRole"
FROM "projects" p
WHERE p."id" = m."projectId" AND m."boardPosition" = 0`,

  // 2. Work that came from a client request was added by that client.
  `UPDATE "milestones" m SET "createdById" = r."clientId"
FROM "task_requests" r
WHERE r."id" = m."sourceTaskRequestId" AND m."createdById" IS NULL`,

  // 3. Board cards become milestones with the same ids, so ?task=<id> links in
  //    old notifications and emails still resolve. A card's milestone becomes
  //    its phase. New rows go to the end of the project's plan. On boot, only
  //    cards made since the last pass: a copy the new code deleted stays gone.
  `INSERT INTO "milestones" ("id", "title", "projectId", "status", "stage", "position",
  "boardPosition", "description", "pricingType", "priority", "parentId", "assigneeId",
  "dueDate", "createdById", "createdByRole", "completedAt", "createdAt", "updatedAt")
SELECT t."id", t."title", t."projectId",
  (CASE t."status" WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS' WHEN 'REVIEW' THEN 'COMPLETED'
    WHEN 'DONE' THEN 'COMPLETED' ELSE 'PENDING' END)::"MilestoneStatus",
  t."status",
  COALESCE(mx."maxPos", -1) + ROW_NUMBER() OVER (PARTITION BY t."projectId" ORDER BY t."createdAt", t."id"),
  CASE WHEN t."position" > 0 THEN t."position" ELSE 1024 END,
  t."description", 'NONE', t."priority", pm."id", t."assigneeId", t."dueDate",
  t."createdById", t."createdByRole", t."completedAt", t."createdAt", t."updatedAt"
FROM "project_tasks" t
LEFT JOIN (SELECT "projectId", MAX("position") AS "maxPos" FROM "milestones" GROUP BY 1) mx
  ON mx."projectId" = t."projectId"
LEFT JOIN "milestones" pm
  ON pm."id" = t."milestoneId" AND pm."projectId" = t."projectId" AND pm."parentId" IS NULL
WHERE NOT EXISTS (SELECT 1 FROM "milestones" m WHERE m."id" = t."id") AND t."createdAt" > $1
ON CONFLICT DO NOTHING`,

  // 4. Card comments follow their card (on boot, those made since the last pass).
  `INSERT INTO "milestone_comments" ("id", "milestoneId", "authorId", "authorRole", "kind",
  "body", "mentions", "attachments", "resolvedAt", "resolvedById", "createdAt")
SELECT c."id", c."taskId", c."authorId", c."authorRole", c."kind", c."body", c."mentions",
  c."attachments", c."resolvedAt", c."resolvedById", c."createdAt"
FROM "project_task_comments" c
JOIN "milestones" m ON m."id" = c."taskId"
WHERE c."createdAt" > $1
ON CONFLICT DO NOTHING`,

  // 5. Requests still waiting for a decision appear on the board as Requested
  //    work, linked back to the request that holds the decision.
  `INSERT INTO "milestones" ("id", "title", "projectId", "status", "stage", "position",
  "boardPosition", "description", "pricingType", "sourceTaskRequestId", "createdById",
  "createdByRole", "createdAt", "updatedAt")
SELECT 'req_' || r."id", r."title", r."projectId", 'PENDING', 'REQUESTED',
  COALESCE(mx."maxPos", -1) + ROW_NUMBER() OVER (PARTITION BY r."projectId" ORDER BY r."createdAt", r."id"),
  1024 * ROW_NUMBER() OVER (PARTITION BY r."projectId" ORDER BY r."createdAt", r."id"),
  r."description", 'NONE', r."id", r."clientId", 'CLIENT', r."createdAt", now()
FROM "task_requests" r
LEFT JOIN (SELECT "projectId", MAX("position") AS "maxPos" FROM "milestones" GROUP BY 1) mx
  ON mx."projectId" = r."projectId"
WHERE r."status" = 'PENDING'
  AND NOT EXISTS (SELECT 1 FROM "milestones" m WHERE m."sourceTaskRequestId" = r."id")
ON CONFLICT DO NOTHING`,

  // 6. Status changes the old code made without touching the stage. A no-op
  //    once everything writes both through work-stage.ts.
  `UPDATE "milestones" SET
  "stage" = (CASE "status" WHEN 'PENDING' THEN 'TODO' WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    ELSE 'DONE' END)::"ProjectTaskStatus",
  "completedAt" = CASE WHEN "status" = 'COMPLETED' THEN COALESCE("completedAt", now()) END
WHERE "stage" <> 'REQUESTED' AND "status" <> (CASE "stage" WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
  WHEN 'REVIEW' THEN 'COMPLETED' WHEN 'DONE' THEN 'COMPLETED' ELSE 'PENDING' END)::"MilestoneStatus"`,

  // 7. USD invoices always carry their USD value; several creation paths
  //    forgot to store it, which kept them out of every USD total.
  `UPDATE "invoices" SET "amountUsd" = "amount"
WHERE "currency" = 'USD' AND "amountUsd" IS NULL AND "creditNoteForId" IS NULL`,

  // The v49c migration: repairs to rows the old code wrote that v49b left in
  // a shape the new code can't handle. The current time is written in UTC,
  // as Prisma writes it, whatever the session's zone.

  // 8. A request the old code declined after step 5 gave it an item: the item
  //    leaves the board the way a decline leaves it now (archived, still
  //    Requested), instead of waiting where no action can clear it.
  `UPDATE "milestones" m SET "archivedAt" = COALESCE(r."resolvedAt", now() AT TIME ZONE 'UTC')
FROM "task_requests" r
WHERE r."id" = m."sourceTaskRequestId" AND r."status" = 'REJECTED'
  AND m."stage" = 'REQUESTED' AND m."archivedAt" IS NULL`,

  // 9. A Requested item whose request was deleted with its client. Only a
  //    client's addition and step 5 write Requested, both with a request.
  `UPDATE "milestones" SET "archivedAt" = now() AT TIME ZONE 'UTC'
WHERE "stage" = 'REQUESTED' AND "sourceTaskRequestId" IS NULL AND "archivedAt" IS NULL`,

  // 10. The client approved work in Review on the old code, which only
  //     stamped the approval. Nothing new leaves an approval on Review work
  //     (sending it for review clears one), so this only finds those.
  `UPDATE "milestones" SET "stage" = 'DONE'
WHERE "stage" = 'REVIEW' AND "clientApprovedAt" IS NOT NULL`,

  // 11. Cards the old board edited after step 3 copied them: a rename, a new
  //     assignee, a move to another column (a client dragging one to Done
  //     must not find it back in Review). Every write of the new code bumps
  //     updatedAt, so its own edits win. Stage, status and completedAt follow
  //     stageWrite, and an approval is kept only in Done. A card keeps its
  //     place unless it changed column, and its phase isn't copied: the copy
  //     may have become a phase with work under it since.
  `UPDATE "milestones" m SET "title" = t."title", "description" = t."description",
  "stage" = t."status",
  "status" = (CASE t."status" WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS' WHEN 'REVIEW' THEN 'COMPLETED'
    WHEN 'DONE' THEN 'COMPLETED' ELSE 'PENDING' END)::"MilestoneStatus",
  "completedAt" = CASE WHEN t."status" IN ('REVIEW', 'DONE') THEN COALESCE(
    CASE WHEN m."stage" IN ('REVIEW', 'DONE') THEN m."completedAt" END, t."completedAt", t."updatedAt") END,
  "clientApprovedAt" = CASE WHEN t."status" = 'DONE' THEN m."clientApprovedAt" END,
  "boardPosition" = CASE WHEN t."status" = m."stage" THEN m."boardPosition"
    WHEN t."position" > 0 THEN t."position" ELSE 1024 END,
  "priority" = t."priority", "dueDate" = t."dueDate", "assigneeId" = t."assigneeId",
  "updatedAt" = t."updatedAt"
FROM "project_tasks" t
WHERE m."id" = t."id" AND t."updatedAt" > m."updatedAt"`,

  // 12. Help questions the old board marked answered after step 4 copied
  //     them. Nothing reopens an answered one now.
  `UPDATE "milestone_comments" mc SET "resolvedAt" = c."resolvedAt", "resolvedById" = c."resolvedById"
FROM "project_task_comments" c
WHERE mc."id" = c."id" AND mc."resolvedAt" IS NULL AND c."resolvedAt" IS NOT NULL`,

  // 13. The old board put a card at 0 or below when it was added or dragged
  //     to the top of a column, and step 3 turned all of those into 1024, so
  //     they lost their order and their place on top. Copies still where
  //     step 3 (or 11) put them, untouched since, go back on top in the old
  //     order, below 1024 and below whatever else heads the column. They end
  //     up under 1024, so this never moves the same row twice.
  `UPDATE "milestones" m SET "boardPosition" = x."pos"
FROM (SELECT t."id",
    LEAST(COALESCE(top."minBoard", 1024), 1024)
      * ROW_NUMBER() OVER (PARTITION BY t."projectId", t."status" ORDER BY t."position", t."createdAt", t."id")
      / (COUNT(*) OVER (PARTITION BY t."projectId", t."status") + 1) AS "pos"
  FROM "project_tasks" t
  JOIN "milestones" c ON c."id" = t."id" AND c."stage" = t."status" AND c."boardPosition" = 1024
    AND c."updatedAt" = t."updatedAt" AND c."archivedAt" IS NULL
  LEFT JOIN (SELECT "projectId", "stage", MIN("boardPosition") AS "minBoard" FROM "milestones"
    WHERE "archivedAt" IS NULL AND "boardPosition" > 0 GROUP BY 1, 2) top
    ON top."projectId" = t."projectId" AND top."stage" = t."status"
  WHERE t."position" <= 0) x
WHERE m."id" = x."id"`,
];

type Db = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  appSetting: {
    findUnique(args: { where: { key: string } }): Promise<{ value: string } | null>;
    createMany(args: { data: { key: string; value: string }[]; skipDuplicates: boolean }): Promise<unknown>;
    upsert(args: {
      where: { key: string };
      create: { key: string; value: string };
      update: { value: string };
    }): Promise<unknown>;
  };
};

/** When the last boot pass started. */
const LAST_PASS_KEY = "workBackfill:v49";

/**
 * When the first boot pass started, written once. Invoices from before it
 * were written by the old code, which linked no line to the work it billed:
 * the line-linking steps and Bill work's allowance for older invoices
 * (dal/billable.ts) only look at those. The SQL names it as text.
 */
export const FIRST_PASS_KEY = "workBackfill:v49:firstBoot";

/**
 * Runs the statements in order and reports how many rows each touched. `since`
 * bounds the steps that copy rows across ($1); the migrations run them unbounded.
 */
export async function backfillWorkItems(
  db: Pick<Db, "$executeRawUnsafe">,
  since: Date,
): Promise<number[]> {
  const counts: number[] = [];
  for (const sql of WORK_BACKFILL_SQL) {
    counts.push(await (sql.includes("$1") ? db.$executeRawUnsafe(sql, since) : db.$executeRawUnsafe(sql)));
  }
  return counts;
}

/**
 * The boot pass: everything an older build wrote since the last pass started.
 * It records its own start rather than its end, so rows written while it runs
 * are picked up next time. Concurrent boots may both run it; every statement
 * tolerates that.
 */
export async function backfillWorkItemsOnBoot(db: Db): Promise<number[]> {
  const startedAt = new Date().toISOString();
  const last = await db.appSetting.findUnique({ where: { key: LAST_PASS_KEY } });
  // A database the first v49 build already ran its one pass on keeps that
  // pass's time as the first.
  await db.appSetting.createMany({
    data: [{ key: FIRST_PASS_KEY, value: last?.value ?? startedAt }],
    skipDuplicates: true,
  });
  const counts = await backfillWorkItems(db, new Date(last?.value ?? 0));
  await db.appSetting.upsert({
    where: { key: LAST_PASS_KEY },
    create: { key: LAST_PASS_KEY, value: startedAt },
    update: { value: startedAt },
  });
  if (counts.some((n, i) => n > 0 && i !== 0)) console.log(`[backfill] work items v49: ${counts.join(", ")}`);
  return counts;
}
