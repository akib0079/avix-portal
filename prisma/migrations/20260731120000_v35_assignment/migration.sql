-- Accountability: who owns a project, who is doing each milestone, and when
-- that milestone is due. All nullable — existing rows keep working unassigned.
ALTER TABLE "projects" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "milestones" ADD COLUMN "assigneeId" TEXT;
ALTER TABLE "milestones" ADD COLUMN "dueDate" TIMESTAMP(3);

CREATE INDEX "projects_ownerId_idx" ON "projects"("ownerId");
CREATE INDEX "milestones_assigneeId_dueDate_idx" ON "milestones"("assigneeId", "dueDate");

ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
