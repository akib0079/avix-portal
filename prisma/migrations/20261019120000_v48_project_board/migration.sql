-- v48: the shared project board — cards both the client and the team can add,
-- move and discuss, plus their comment threads and help requests.

-- CreateEnum
CREATE TYPE "ProjectTaskStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE');

-- CreateEnum
CREATE TYPE "ProjectTaskCommentKind" AS ENUM ('COMMENT', 'HELP');

-- AlterEnum

ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_TASK_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_TASK_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_TASK_COMMENT';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_TASK_MENTION';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_TASK_HELP';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_TASK_REVIEW';

-- CreateTable
CREATE TABLE "project_tasks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" JSONB,
    "status" "ProjectTaskStatus" NOT NULL DEFAULT 'TODO',
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priority" "Priority",
    "dueDate" TIMESTAMP(3),
    "milestoneId" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "createdByRole" "MessageSenderRole" NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_task_comments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorRole" "MessageSenderRole" NOT NULL,
    "kind" "ProjectTaskCommentKind" NOT NULL DEFAULT 'COMMENT',
    "body" TEXT NOT NULL,
    "mentions" JSONB,
    "attachments" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_tasks_projectId_status_position_idx" ON "project_tasks"("projectId", "status", "position");

-- CreateIndex
CREATE INDEX "project_tasks_assigneeId_idx" ON "project_tasks"("assigneeId");

-- CreateIndex
CREATE INDEX "project_task_comments_taskId_createdAt_idx" ON "project_task_comments"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "project_task_comments_kind_resolvedAt_idx" ON "project_task_comments"("kind", "resolvedAt");

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_task_comments" ADD CONSTRAINT "project_task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_task_comments" ADD CONSTRAINT "project_task_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

