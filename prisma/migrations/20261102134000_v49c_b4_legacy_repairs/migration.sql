-- v49c: data repairs only, after v49b. Generated from src/lib/work-backfill.ts
-- (the statements after v49b's), which runs them again on every boot of the
-- new code to catch rows an older build wrote since. Each one only matches
-- rows still in the shape the old code writes, so it is safe to repeat; see
-- that file for notes.

UPDATE "milestones" m SET "archivedAt" = COALESCE(r."resolvedAt", now() AT TIME ZONE 'UTC')
FROM "task_requests" r
WHERE r."id" = m."sourceTaskRequestId" AND r."status" = 'REJECTED'
  AND m."stage" = 'REQUESTED' AND m."archivedAt" IS NULL;

UPDATE "milestones" SET "archivedAt" = now() AT TIME ZONE 'UTC'
WHERE "stage" = 'REQUESTED' AND "sourceTaskRequestId" IS NULL AND "archivedAt" IS NULL;

UPDATE "milestones" SET "stage" = 'DONE'
WHERE "stage" = 'REVIEW' AND "clientApprovedAt" IS NOT NULL;

UPDATE "milestones" m SET "title" = t."title", "description" = t."description",
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
WHERE m."id" = t."id" AND t."updatedAt" > m."updatedAt";

UPDATE "milestone_comments" mc SET "resolvedAt" = c."resolvedAt", "resolvedById" = c."resolvedById"
FROM "project_task_comments" c
WHERE mc."id" = c."id" AND mc."resolvedAt" IS NULL AND c."resolvedAt" IS NOT NULL;
