-- v49b: move the work data into the unified milestones (schema in v49).
-- Generated from src/lib/work-backfill.ts, which runs the same statements once
-- more on the first boot of the new code to catch rows written by the old code
-- during the deploy. Every statement is idempotent; see that file for notes.

UPDATE "milestones" m SET
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
WHERE p."id" = m."projectId" AND m."boardPosition" = 0;

UPDATE "milestones" m SET "createdById" = r."clientId"
FROM "task_requests" r
WHERE r."id" = m."sourceTaskRequestId" AND m."createdById" IS NULL;

INSERT INTO "milestones" ("id", "title", "projectId", "status", "stage", "position",
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
WHERE NOT EXISTS (SELECT 1 FROM "milestones" m WHERE m."id" = t."id")
ON CONFLICT DO NOTHING;

INSERT INTO "milestone_comments" ("id", "milestoneId", "authorId", "authorRole", "kind",
  "body", "mentions", "attachments", "resolvedAt", "resolvedById", "createdAt")
SELECT c."id", c."taskId", c."authorId", c."authorRole", c."kind", c."body", c."mentions",
  c."attachments", c."resolvedAt", c."resolvedById", c."createdAt"
FROM "project_task_comments" c
JOIN "milestones" m ON m."id" = c."taskId"
ON CONFLICT DO NOTHING;

INSERT INTO "milestones" ("id", "title", "projectId", "status", "stage", "position",
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
ON CONFLICT DO NOTHING;

UPDATE "milestones" SET
  "stage" = (CASE "status" WHEN 'PENDING' THEN 'TODO' WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    ELSE 'DONE' END)::"ProjectTaskStatus",
  "completedAt" = CASE WHEN "status" = 'COMPLETED' THEN COALESCE("completedAt", now()) END
WHERE "stage" <> 'REQUESTED' AND "status" <> (CASE "stage" WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
  WHEN 'REVIEW' THEN 'COMPLETED' WHEN 'DONE' THEN 'COMPLETED' ELSE 'PENDING' END)::"MilestoneStatus";

UPDATE "invoices" SET "amountUsd" = "amount"
WHERE "currency" = 'USD' AND "amountUsd" IS NULL AND "creditNoteForId" IS NULL;
