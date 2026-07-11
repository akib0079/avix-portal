-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'PROPOSAL', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('FIVERR', 'UPWORK', 'REFERRAL', 'WEBSITE', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'MILESTONE_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_CLAIMED';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "paymentClaimedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "milestones" ADD COLUMN     "clientApprovedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "company" TEXT,
    "source" "LeadSource" NOT NULL DEFAULT 'OTHER',
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "estimatedValue" DECIMAL(10,2),
    "notes" TEXT,
    "nextFollowUp" TIMESTAMP(3),
    "convertedClientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_stage_nextFollowUp_idx" ON "leads"("stage", "nextFollowUp");
