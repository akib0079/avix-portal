-- v49: one work item. Board cards (project_tasks) fold into milestones, which
-- gain a board stage, a column position, priority, one level of phases, a
-- creator, completion and archive stamps, and their own comment thread.
-- Invoices learn drafts, duplication, billed-work links, reminder state and a
-- hosted pay link; retainers become general recurring schedules; proposals
-- get currency, terms, view tracking, archive and signature evidence.
--
-- Everything here is additive. The data moves in v49b, a separate migration
-- because Postgres can't use an enum value in the transaction that adds it.

-- CreateEnum
CREATE TYPE "SignatureRole" AS ENUM ('CLIENT', 'AGENCY');

-- CreateEnum
CREATE TYPE "SignatureMethod" AS ENUM ('DRAWN', 'TYPED', 'ADMIN_RECORDED');

-- CreateEnum
CREATE TYPE "ProposalEventType" AS ENUM ('SENT', 'RESENT', 'VIEWED', 'SIGNED', 'DECLINED', 'EXPIRED', 'EXTENDED', 'REMINDED', 'ARCHIVED', 'RESTORED');

-- CreateEnum
CREATE TYPE "ScheduleUnit" AS ENUM ('WEEK', 'MONTH');

-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'DRAFT' BEFORE 'ASSIGNED';

-- AlterEnum

ALTER TYPE "NotificationType" ADD VALUE 'PROPOSAL_VIEWED';
ALTER TYPE "NotificationType" ADD VALUE 'PROPOSAL_DECLINED';
ALTER TYPE "NotificationType" ADD VALUE 'RECURRING_INVOICE_FAILED';

-- AlterEnum
ALTER TYPE "ProjectTaskStatus" ADD VALUE 'REQUESTED' BEFORE 'BACKLOG';

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "milestoneId" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "duplicatedFromId" TEXT,
ADD COLUMN     "payLinkUrl" TEXT,
ADD COLUMN     "preDueReminderAt" TIMESTAMP(3),
ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "remindersPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retainerPeriod" TEXT;

-- AlterTable
ALTER TABLE "milestones" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "boardPosition" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "createdByRole" "MessageSenderRole" NOT NULL DEFAULT 'ADMIN',
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "priority" "Priority",
ADD COLUMN     "stage" "ProjectTaskStatus" NOT NULL DEFAULT 'TODO';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "autoAcceptClientTasks" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "proposals" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "createdClientAccount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "currency" "InvoiceCurrency" NOT NULL DEFAULT 'USD',
ADD COLUMN     "declineReason" TEXT,
ADD COLUMN     "declinedAt" TIMESTAMP(3),
ADD COLUMN     "documentHash" TEXT,
ADD COLUMN     "firstViewedAt" TIMESTAMP(3),
ADD COLUMN     "lastReminderAt" TIMESTAMP(3),
ADD COLUMN     "lastViewedAt" TIMESTAMP(3),
ADD COLUMN     "linkVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "terms" TEXT,
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "retainers" ADD COLUMN     "amountUsd" DECIMAL(12,2),
ADD COLUMN     "autoSend" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "currency" "InvoiceCurrency" NOT NULL DEFAULT 'USD',
ADD COLUMN     "endAfterCount" INTEGER,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "frequency" "ScheduleUnit" NOT NULL DEFAULT 'MONTH',
ADD COLUMN     "interval" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lastRunAt" TIMESTAMP(3),
ADD COLUMN     "lastRunError" TEXT,
ADD COLUMN     "nextRunAt" TIMESTAMP(3),
ADD COLUMN     "paymentTermsDays" INTEGER,
ADD COLUMN     "runCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "templateInvoiceId" TEXT;

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN     "invoiceItemId" TEXT;

-- CreateTable
CREATE TABLE "milestone_comments" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorRole" "MessageSenderRole" NOT NULL,
    "kind" "ProjectTaskCommentKind" NOT NULL DEFAULT 'COMMENT',
    "body" TEXT NOT NULL,
    "mentions" JSONB,
    "attachments" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_signatures" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT,
    "clientId" TEXT,
    "role" "SignatureRole" NOT NULL DEFAULT 'CLIENT',
    "method" "SignatureMethod" NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "signerTitle" TEXT,
    "signerCompany" TEXT,
    "imagePng" BYTEA,
    "typedFont" TEXT,
    "consentText" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "tokenFingerprint" TEXT,
    "recordedById" TEXT,
    "pdfPath" TEXT,
    "pdfSha256" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_events" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "type" "ProposalEventType" NOT NULL,
    "actorId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestone_comments_milestoneId_createdAt_idx" ON "milestone_comments"("milestoneId", "createdAt");

-- CreateIndex
CREATE INDEX "milestone_comments_kind_resolvedAt_idx" ON "milestone_comments"("kind", "resolvedAt");

-- CreateIndex
CREATE INDEX "proposal_signatures_proposalId_idx" ON "proposal_signatures"("proposalId");

-- CreateIndex
CREATE INDEX "proposal_signatures_clientId_idx" ON "proposal_signatures"("clientId");

-- CreateIndex
CREATE INDEX "proposal_events_proposalId_createdAt_idx" ON "proposal_events"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "invoice_items_milestoneId_idx" ON "invoice_items"("milestoneId");

-- CreateIndex
CREATE INDEX "invoices_duplicatedFromId_idx" ON "invoices"("duplicatedFromId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_retainerId_retainerPeriod_key" ON "invoices"("retainerId", "retainerPeriod");

-- CreateIndex
CREATE INDEX "milestones_projectId_stage_boardPosition_idx" ON "milestones"("projectId", "stage", "boardPosition");

-- CreateIndex
CREATE INDEX "milestones_parentId_idx" ON "milestones"("parentId");

-- CreateIndex
CREATE INDEX "proposals_archivedAt_idx" ON "proposals"("archivedAt");

-- CreateIndex
CREATE INDEX "retainers_active_nextRunAt_idx" ON "retainers"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "time_entries_invoiceItemId_idx" ON "time_entries"("invoiceItemId");

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_comments" ADD CONSTRAINT "milestone_comments_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_comments" ADD CONSTRAINT "milestone_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "invoice_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_duplicatedFromId_fkey" FOREIGN KEY ("duplicatedFromId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_signatures" ADD CONSTRAINT "proposal_signatures_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_events" ADD CONSTRAINT "proposal_events_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_templateInvoiceId_fkey" FOREIGN KEY ("templateInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

