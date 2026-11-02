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
 * prisma/migrations/20261102120100_v49b_unified_work_backfill/migration.sql —
 * work-backfill.test.ts fails if the two drift. Only the boot pass bounds
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
