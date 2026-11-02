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
