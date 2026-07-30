-- Project-scoped audit trail. Nullable: existing rows keep their client scope,
-- and events that aren't about a project (leads, campaigns) never set it.
ALTER TABLE "activity_events" ADD COLUMN "projectId" TEXT;
CREATE INDEX "activity_events_projectId_createdAt_idx" ON "activity_events"("projectId", "createdAt");
