-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CampaignStatus" ADD VALUE 'SCHEDULED';
ALTER TYPE "CampaignStatus" ADD VALUE 'QUEUED';

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "name" TEXT,
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "campaigns_status_scheduledAt_idx" ON "campaigns"("status", "scheduledAt");
